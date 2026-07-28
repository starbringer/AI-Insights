# 架构

[English](architecture.md) | **简体中文**

应用是如何组装起来的，以及在哪里接入新的 AI 工具。

- [两个扩展接缝](#两个扩展接缝)
- [转录 Provider](#转录-provider)
- [配置适配器](#配置适配器)
- [新增一个 Provider](#新增一个-provider)
- [MCP 服务器](#mcp-服务器)
- [自动装配](#自动装配)
- [MCP 为什么读配置文件而不用 CLI](#mcp-为什么读配置文件而不用-cli)
- [写入安全](#写入安全)
- [网络绑定](#网络绑定)
- [Token 估算](#token-估算)

## 两个扩展接缝

所有与具体工具相关的逻辑都藏在两个接口之一的后面。API 层、聚合层和整个 UI 只会看到
中性的数据结构。

| 接缝 | 接口 | 回答的问题 |
|---|---|---|
| **转录 Provider** | [`src/providers/types.ts`](../src/providers/types.ts) | 使用数据在哪里？如何解析成 run / agent / turn？ |
| **配置适配器** | [`src/config/types.ts`](../src/config/types.ts) | 这个工具配置了什么 —— 指令、命令、skill、hook、MCP、权限、记忆、设置？ |

一个工具可以只实现其中一个，也可以两个都实现。Claude Code 两个都实现了；
未来的 Codex/OpenCode/Cline 适配器可以只实现任意子集。

## 转录 Provider

```ts
export interface Provider {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData(): boolean;
  watchGlobs(): string[];                      // 监听器需要关注的匹配模式
  fileMatches(path: string): boolean;          // 这个路径属于本 provider 吗？
  scanAll(db): void;                           // 启动时的全量扫描
  ingestFile(db, path): void;                  // 单个文件的增量更新
  loadAgentDetail(agentId): NormalizedTurn[];  // 详情页所需的行数据
}
```

[`src/providers/index.ts`](../src/providers/index.ts) 中的注册表列出了每个 provider；
`providerForPath(path)` 负责把变更的文件路由到对应的 provider。
`GET /api/providers` 把这份列表连同请求时计算的 `hasData` 标志一起暴露给 UI ——
顶栏的 **Source ▾** 切换器就是由它填充的。

监听器、聚合、价格与 UI 都与 provider 无关：它们只操作 SQLite 中的行和
`NormalizedTurn` 对象。价格按模型名匹配，因此任何 provider 只要它的回合带有可识别的
模型字符串，就能自动获得成本计算。

### Claude Code

[`src/providers/claude-code/`](../src/providers/claude-code/) 读取
`~/.claude/projects/**/*.jsonl`。它识别以下约定：

- **多行响应** —— 一次 API 响应会跨多行 `assistant` 记录（每个 content block 一行），
  它们共享同一个 `message.id`；这些行会被归并成一个回合。
- **`<synthetic>` 错误回显**（`isApiErrorMessage`）—— 不计入用量，在会话树中渲染为
  错误节点。
- **`system` 行** —— `stop_hook_summary`（hook 触发）、`api_error`（重试）、
  `compact_boundary`（上下文压缩，通过 `logicalParentUuid` 重新连接）、
  `model_refusal_fallback`、`turn_duration`。
- **`attachment` 行** —— todo 提醒、延迟加载的工具、IDE 状态；显示为注入上下文节点。
- **`ai-title` 行** —— 运行标题的首选来源。
- **uuid/parentUuid 分叉** —— 由提示词编辑和重试产生；主干是拥有最新后代的那条路径，
  旁支会成为折叠的分支子树。
- **子智能体转录文件**，位于 `<parent-agent-id>/subagents/agent-*.jsonl`，以及文件内
  的 sidechain（`isSidechain`）。
- **`sourceToolUseID`** —— 把注入的内容（skill 正文）链接回产生它的那次工具调用。

无需任何 API key；全部解析都在本地完成。

## 配置适配器

即 Harness 标签页背后的接口。

```ts
export interface ToolConfigAdapter {
  providerId: string;
  capabilities(): CapabilityFlags;
  listInstructionFiles?(db): InstructionFile[];
  getInstructionsReport?(db): InstructionsReport;
  readInstructionFile?(path): string;
  writeInstructionFile?(path, content): void;
  listCommands?(db): CommandInfo[];
  // …skills、hooks（含脚本读/写/删）、permissions、mcp、memory、effective
}
```

每个方法都是可选的。`capabilities()` 声明该适配器能做什么，
`GET /api/config/capabilities` 再把结果交给 UI —— 只有当前 provider 声明了某项能力，
对应标签页才会渲染；任何缺少对应能力的 `/api/config/*` 路由都会返回 `501`。

- 注册表：[`src/config/index.ts`](../src/config/index.ts)
- 中性数据结构：[`src/config/types.ts`](../src/config/types.ts)
- Claude Code 的实现：[`src/providers/claude-code/config/`](../src/providers/claude-code/config/)
- 依赖图构建器：[`src/config/graph.ts`](../src/config/graph.ts) —— 它本身与 provider
  无关，只消费适配器输出的中性数据，从不接触工具专有文件。边分两种：**内容引用**
  （某个 skill 的正文中出现了 `mcp__server__tool`，画成实线）和**名称关键词相似**
  （画成虚线）；连通分量即依赖链，按 hook → MCP → skill → command 排序，并呈现为
  Skills 与 MCP 标签页中的「关联组件」区域。

适配器内部处理的 Claude Code 专有细节包括：三个配置来源（用户 > 项目 > 插件）及其
覆盖优先级、`:` 命名空间的命令名、设置分层（local > project > user，其中部分键该工具
只从某一层读取 —— 自 Claude Code 2.1.207 起 `autoMode`、`pluginConfigs` 仅在用户层
生效），以及支持块标量的 YAML frontmatter 解析。

有两条分层规则并非简单的“高层覆盖低层”：

- **权限规则是累加的。** `permissions.allow` / `deny` / `ask` 在所有层同时生效，因此
  `/api/config/effective` 会把各层拼接起来，并返回 `mergedLevels` 而不是
  `overriddenLevels`。同级的 `permissions.defaultMode` 等键仍按覆盖处理。
- **`.claude` 目录就是 `~/.claude` 的项目不贡献任何层。** 当 Claude Code 以主目录
  作为 cwd 运行时就会出现这种情况；把它当作项目层读取等于让用户层和自己比较，
  会导致每个 hook、skill、command 被重复计算。
  [`config/shared.ts`](../src/providers/claude-code/config/shared.ts) 中的
  `shadowsUserConfig()` 负责过滤。

## 新增一个 Provider

**使用数据（Dashboard、Runs、运行详情）：**

1. 创建 `src/providers/<id>/index.ts`，导出一个实现 `Provider` 的对象。
2. 编写一个解析器遍历 `dataDir`，通过
   [`src/transcripts/cache.ts`](../src/transcripts/cache.ts) 中的辅助函数 upsert 行数据；
   再写一个返回 `NormalizedTurn[]` 的详情加载器。
3. 把该对象追加到 [`src/providers/index.ts`](../src/providers/index.ts) 的 `PROVIDERS` 中。

**配置（Harness 标签页）：**

1. 为该工具创建一个 `ToolConfigAdapter` —— 只实现对它有意义的能力。
2. 在 [`src/config/index.ts`](../src/config/index.ts) 的 `CONFIG_ADAPTERS` 中注册。
3. 到此为止。标签页、路由、MCP 工具和依赖图都会跟随 `capabilities()` 的声明自动适配。

**自动装配（可选）：** 在适配器上实现 `isInstalled`、`installSkill` 和
`registerMcpServer`，内置技能与 MCP 注册就会一并推送到该工具。见[自动装配](#自动装配)。

## MCP 服务器

本应用既是 MCP *客户端*（探测你配置的服务器以列出其工具，见下文），也是 MCP
*服务器*（对外暴露自己的分析数据）。两者是互不相干的代码路径，只是恰好说同一种协议。

服务器位于 [`src/mcp/`](../src/mcp/)，按“协议与传输不会各自漂移”的原则拆分：

| 文件 | 职责 |
|---|---|
| `src/mcp/tools.ts` | 工具注册表。每个工具调用与对应 HTTP 路由完全相同的库函数 —— 一份实现，两道前门 |
| `src/mcp/protocol.ts` | 与传输无关的 JSON-RPC 分发：`initialize`、`tools/list`、`tools/call`、`ping` |
| `src/api/mcpEndpoint.ts` | Streamable HTTP 传输，挂载在仪表盘同一端口的 `/mcp` |
| `mcp-stdio.ts` | 面向只能以子进程方式启动服务器的客户端的 stdio 传输 |

三个值得了解的设计决定：

**无状态。** 不签发 `Mcp-Session-Id`，每个 POST 都以单个 `application/json` 响应体作答，
而非 SSE 流。服务器不保存任何按客户端的状态，也从不主动发消息，因此会话没有收益，只会
带来一整类过期相关的 bug。这两点都是规范明确允许的。

**只读。** 没有任何工具包装写入路由。写入路径会修改 CLAUDE.md、hook 脚本和技能 ——
这类变更必须经过人。建议以文本形式返回，由用户自己的助手用其受权限管控的编辑工具落地。

**协议手写，而非引入 SDK。** 线上格式只有约 200 行 JSON-RPC，直接对接 Bun 的 `fetch`
处理器。官方 SDK 的 HTTP 传输需要 Node 的 `IncomingMessage`/`ServerResponse` 对象，而
Bun 上的 Hono 没有；适配它比实现本服务器要回答的这几个方法更脆弱。
`src/mcp/protocol.test.ts` 固定了线上格式。

## 自动装配

启动时，应用会把自己的资产安装进本机上存在的 AI 工具：`ai-usage-review` 技能，以及自身
MCP 端点的注册。[`src/provision.ts`](../src/provision.ts) 与 provider 无关 —— 它遍历
`CONFIG_ADAPTERS`，调用三个可选的适配器方法：

```ts
isInstalled?(): boolean;                                  // 该工具在本机上吗？
installSkill?(pkg: SkillPackage): ProvisionResult;        // 写入其技能目录
registerMcpServer?(s: McpServerRegistration): Promise<ProvisionResult>;
```

未实现这些方法的适配器直接跳过装配，因此新增一个工具只需在它自己的目录内实现这三个方法
—— `src/providers/<id>/` 之外无需任何改动。

技能资产以真实 markdown 文件形式放在 [`assets/skills/`](../assets/skills/)，与 `static/`
一样按可执行文件的位置解析，从而保持可评审、可编辑，而不是被内联成 TypeScript 字符串。

**为什么用 `claude mcp add` 而不是直接写文件。** Claude Code 适配器通过该工具自己的 CLI
注册服务器。`~/.claude.json` 同时保存着按项目的会话状态，可能有数 MB；从本进程做
读-改-写会与正在运行的 Claude Code 竞争，可能把它覆盖掉。适配器只*读取*该文件，用于判断
注册是否已经正确。当 CLI 无法运行时，装配会打印确切的命令，而不是去猜。

每一步都幂等且先比对后写入，因此第二次运行是无输出的空操作。`--no-provision` 可完全关闭。

## MCP 为什么读配置文件而不用 CLI

早期版本会调用 `claude mcp list` 并解析它面向人类的输出。这在代码毫无改动的情况下也
反复出问题：该 CLI 在打印前会对每个服务器做健康检查（因此只要有一个服务器慢，或者
网络冷启动，超过 spawn 超时后整份列表就会空掉），而且它的输出格式会随 CLI 版本漂移。

MCP 标签页改为直接读取 CLI 所读的同一批文件（`~/.claude.json`、`.mcp.json`），既确定
又即时。只有可选的工具/schema 探测才会真正接触服务器；结果按配置定义缓存 10 分钟，
任何失败都会在诊断面板中呈现。

**探测的知情同意。** 项目级服务器随仓库的 `.mcp.json` 一起分发 —— 属于第三方内容，
Claude Code 自己也要求你逐项目批准后才会运行。本标签页遵循同样的原则：未批准或已禁用
的项目级服务器只会被*列出*并标明作用域，绝不会被执行或联网，且其行内会说明为何没有
工具数据。claude.ai 托管的连接器只按名称列出，因为它们的定义在你的账户里而不在本地
磁盘上。

## 写入安全

全部写入路径只有：CLAUDE.md 编辑器、命令的编辑/创建/删除、skill 编辑器、hook 脚本
编辑器和 hook 删除。

每次写入都会在服务端对照适配器自己枚举出的文件集合做校验：hook 脚本必须被某个已枚举
的 hook 引用，hook 删除必须指向已枚举的条目，指令/skill/命令文件必须是对应列表接口
返回过的文件之一。路径比较在 Windows 上忽略大小写。该 API 无法写入任意路径，插件
拥有的文件始终只读。

## 网络绑定

服务器默认绑定 `127.0.0.1`。由于配置 API 可以修改磁盘上的文件，把它暴露到局域网就等
于让网络中的任意页面 —— 或任何能访问到它的提示词 —— 变成一个文件写入器。如果你确实
需要，请主动用 `--host=0.0.0.0` 或 `HOST=0.0.0.0` 覆盖。

## Token 估算

提示词注入成本（CLAUDE.md 体积、hook 载荷、MCP schema、skill 正文）使用
[`js-tiktoken`](https://github.com/dqbd/tiktoken) 的 `cl100k_base` 编码估算，它以 WASM
在本地运行。已记录的 token *用量*从不做估算 —— 它直接来自转录文件自带的 `usage` 数字。
