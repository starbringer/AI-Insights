# 架构

[English](architecture.md) | **简体中文**

应用是如何组装起来的，以及在哪里接入新的 AI 工具。

- [两个扩展接缝](#两个扩展接缝)
- [转录 Provider](#转录-provider)
- [配置适配器](#配置适配器)
- [新增一个 Provider](#新增一个-provider)
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
  （画成虚线）；连通分量就是工作流链，按 hook → MCP → skill → command 排序。

适配器内部处理的 Claude Code 专有细节包括：三个配置来源（用户 > 项目 > 插件）及其
覆盖优先级、`:` 命名空间的命令名、设置分层（local > project > user，其中部分键该工具
只从某一层读取 —— 自 Claude Code 2.1.207 起 `autoMode`、`pluginConfigs` 仅在用户层
生效），以及支持块标量的 YAML frontmatter 解析。

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
3. 到此为止。标签页、路由和依赖图都会跟随 `capabilities()` 的声明自动适配。

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
