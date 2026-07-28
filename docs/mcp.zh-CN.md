# MCP 服务器与用量复盘技能

[English](mcp.md) | **简体中文**

仪表盘回答的是你想得到要问的问题。MCP 服务器让 AI 助手替你去问：它把同一份数据 ——
token、成本、会话，以及整个 harness 配置 —— 暴露为可调用的工具；内置的
`ai-usage-review` 技能再把这些数据变成有排序、有证据支撑的优化建议。

两者都随应用一起启动。没有第二个进程要开，也不需要 Docker。

---

## 安装

```bash
bun run start
```

这就是全部安装步骤。启动时应用会：

1. 在与仪表盘相同的端口上提供 MCP 端点 **`http://127.0.0.1:5757/mcp`**
   （streamable HTTP 传输）；
2. 把 `ai-usage-review` 技能安装到检测到的每个 AI 工具的用户级技能目录
   （Claude Code 为 `~/.claude/skills/ai-usage-review/`）；
3. 通过各工具自己的 CLI 注册该端点 ——
   `claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp`。

每一步都是幂等的：首次运行打印一行日志，之后保持安静。重启一次你的 AI 工具让它加载新
服务器，然后让它复盘你的用量，或直接运行 `/ai-usage-review`。

### 验证

```bash
curl http://127.0.0.1:5757/api/mcp-server     # 人类可读：工具清单、协议版本
```

在 Claude Code 中，`/mcp` 会把 `ai-insights` 列入已连接的服务器。

### 如果自动注册被跳过

应用会打印需要执行的确切命令。当工具的 CLI 不在 `PATH` 上时，它会选择打印而不是注册。
Claude Code：

```bash
claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp
```

### 关闭自动装配

| 参数 | 效果 |
|---|---|
| `--no-provision` | 不安装技能、不注册 MCP 服务器。`/mcp` 端点仍然提供服务。 |

MCP 端点本身属于 HTTP 服务器，不可单独关闭；它是只读的，并遵循与其余 API 相同的回环
绑定策略。

### 更换端口

装配以 URL 为键。换端口启动后，下次运行会自动把服务器重新注册到新地址：

```bash
bun run start --port=8080     # 重新注册到 http://127.0.0.1:8080/mcp
```

即便传入 `--host=0.0.0.0`，注册的 URL 也始终使用 `127.0.0.1` —— 客户端总在同一台机器
上，而局域网地址绝不该出现在配置文件里。

---

## 连接其他客户端

### Claude Code（及任何支持 streamable HTTP 的客户端）

```bash
claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp
```

自动装配已经替你做了；这里列出命令是为了手动配置。

### 只支持 stdio 的客户端

有些客户端只能以子进程方式启动 MCP 服务器。为它们提供了 stdio 入口：

```bash
bun run mcp        # = bun run mcp-stdio.ts
```

将其配置为 stdio 服务器，命令为 `bun`，参数为
`["run", "/绝对路径/ai-insights/mcp-stdio.ts"]`。

它完全独立 —— 打开同一个 SQLite 缓存，并在启动时从转录记录刷新，因此无论仪表盘是否在
运行都能工作。传入 `--no-scan` 可跳过刷新、直接读取现有缓存（启动更快，但可能过期）。
两个进程通过 SQLite 的 WAL 模式共存。

`bun run build:mcp` 会把它编译为独立二进制 `dist/ai-insights-mcp`，供更愿意直接启动可
执行文件的客户端使用。

---

## 工具

每个工具都接受一个可选的 **`provider`** 参数来指定数据源。默认为 `claude-code`；传
`all` 可跨所有已注册数据源汇总。未知 id 会返回一条列出合法取值的错误。答案不随数据源
变化的三个工具（`list_providers`、`get_pricing`、`get_thresholds`）不带该参数。

### 用量

| 工具 | 返回 |
|---|---|
| `list_providers` | 已注册数据源及实时 `hasData` 标志 |
| `get_usage_summary` | 今日 / 7 天 / 30 天总量与成本、缓存命中率、活跃运行数 |
| `get_usage_timeseries` | 某时间范围内的 token 趋势，分桶粒度自适应 |
| `get_daily_usage` | 最长 365 天的逐日总量 |
| `get_model_usage` | 按模型的总量 |
| `get_project_usage` | 按项目目录的总量、运行数与智能体数 |
| `list_runs` | 分页会话列表（`limit`、`offset`、`project`、`search`） |
| `get_run` | 单次运行及其全部智能体 |
| `get_run_usage` | 单次运行按分类桶与模型的成本拆解，**外加已渲染成文字的调优建议** |
| `get_top_runs` | 按 token 排序的会话 |
| `get_top_turns` | 开销最大的单次 API 调用 |
| `get_mcp_usage` | 每个 MCP 服务器的估算 token，含按工具拆分 |
| `get_skill_usage` | 已记录的技能调用及其注入 token |
| `list_agents` | 智能体及其模型、回合数与 token 总量 |

### Harness 配置

| 工具 | 返回 |
|---|---|
| `get_harness_capabilities` | 当前 provider 的适配器支持哪些配置能力 |
| `list_instruction_files` | 指令文件及其 token 数与 30 天注入序列 |
| `read_instruction_file` | 某个已枚举指令文件的完整内容 |
| `list_commands` | 所有来源的斜杠命令，带覆盖标记 |
| `list_skills` | 技能及其触发词、token 成本与 30 天**实际**使用记录 |
| `list_hooks` | 跨配置层的 hook 条目及**实际**触发次数 |
| `read_hook_script` | 某个 hook 脚本文件的源码 |
| `get_permissions` | 合并后的 allow / deny / ask 规则，并标出被遮蔽的规则 |
| `list_mcp_servers` | 已配置的 MCP 服务器、探测状态、工具、schema token 成本 |
| `list_memory_stores` | 按项目的记忆库，含孤儿文件检测 |
| `get_effective_config` | 合并后的设置层、覆盖关系、以及“该层不会被读取”的告警 |
| `get_dependency_graph` | 技能、hook、MCP 服务器与命令之间的相互引用 |
| `list_config_projects` | 从转录记录中发现的项目目录 |

### 应用设置

| 工具 | 返回 |
|---|---|
| `get_pricing` | 驱动全部成本数字的分模型参考价格表 |
| `get_thresholds` | 已配置的告警/错误阈值 |

### 载荷克制

可能返回整份文件的工具默认只返回元数据：

| 工具 | 开关 | 默认 |
|---|---|---|
| `list_skills`、`list_commands` | `includeContent` | `false` —— 省略正文 |
| `list_mcp_servers` | `includeSchemas` | `false` —— 省略 JSON schema |
| `get_run_usage` | `includeSeries` | `false` —— 逐次调用序列替换为其长度 |

文件内容在 20,000 字符处截断并显式标注。一个用来诊断上下文膨胀的工具，不该自己制造膨胀。

---

## 刻意**未**暴露的部分

MCP 面是**只读**的。以下 HTTP 路由没有对应工具：

| 未暴露 | 原因 |
|---|---|
| `PUT /api/config/instructions/file` | 让一次分析悄悄改写 CLAUDE.md 是自伤 |
| `PUT/POST/DELETE /api/config/commands` | 同理 —— 命令是用户撰写的配置 |
| `PUT /api/config/skills/file` | 同理，且能改技能的技能可以改自己 |
| `PUT/DELETE /api/config/hooks*` | hook 会执行 shell 命令，写入必须有人参与 |
| `PUT /api/settings/thresholds` | 允许修改阈值等于让复盘自己挪动评判标准 |
| `GET /api/agent/:id`、`GET /api/agent/:id/tree` | 完整转录与面向 UI 渲染的会话树，每个动辄数万 token。同一会话的成本请用 `get_run_usage` |

建议以文本返回，由用户自己的助手用其常规、受权限管控的编辑工具落地 —— 在那里它们会以
diff 呈现，也可以被拒绝。这正是重点：复盘负责建议，人负责拍板。

---

## 安全

- 与其余 API 一样绑定回环地址。
- 每个 MCP 请求都做 **Origin 校验**：携带非回环 `Origin` 头的请求以 403 拒绝，从而阻断
  来自网页的 DNS 重绑定攻击。原生客户端不发 `Origin`，可正常通过。
- `GET /mcp` 与 `DELETE /mcp` 返回 `405` —— 服务器不提供主动推送的 SSE 流，也不持有会话。
- 不受支持的 `MCP-Protocol-Version` 头以 400 拒绝。

服务器无状态：不签发 `Mcp-Session-Id`，每个 POST 独立成立，每条 JSON-RPC 请求以单个
`application/json` 响应体作答。协议版本 `2025-06-18`（默认）、`2025-03-26` 与
`2024-11-05` 在 `initialize` 阶段协商。

---

## `ai-usage-review` 技能

安装到 `~/.claude/skills/ai-usage-review/`（以及其他检测到的工具的对应目录）。源文件位于
[`assets/skills/ai-usage-review/`](../assets/skills/ai-usage-review/) —— 在那里编辑并重启
应用即可推送更新。

用 `/ai-usage-review` 调用，或者直接问：*“复盘一下我的 Claude Code 用量”*、
*“为什么我的会话这么贵？”*、*“这个该做成 skill 还是 hook？”*

### 它做什么

1. 先确定要看哪个 provider（`list_providers`），再为之后每次调用指定作用域。
2. 按固定顺序采集 —— 支出形态 → 浪费信号 → 单会话细节 → 常驻上下文 → 扩展项 ROI →
   确定性缺口 → 正确性 —— 一旦结论有了支撑就停止采集。
3. 执行 `references/playbook.md` 中的 11 项检查，每项都有测量值、阈值、修复方案，以及
   一条“如何用真实数字估算节省”的规则。
4. 输出至多 7 条按预估节省排序的发现，每条都注明数据来自哪次工具调用，并以“先做这件事”
   收尾。
5. 主动提出用你助手自己的编辑工具落地其中机械性的改动。

### 检查清单

| # | 检查 | 触发条件 |
|---|---|---|
| C1 | 指令文件对每个回合征税 | 单文件超过约 2,000 token，或 30 天注入超过 200 万 token |
| C2 | 高价模型在做常规工作 | 高价档占 token 超过 50% |
| C3 | 提示缓存没命中 | 30 天低于 50%；单次运行低于 30% |
| C4 | 会话携带过多上下文 | 单次调用超过 20 万 token，或单次运行占该周期 20% 以上 |
| C5 | 不划算的技能 | 30 天零调用、被同名高优先级定义遮蔽，或正文很大而使用很少 |
| C6 | MCP 服务器入不敷出 | schema 超过 2,000 token 且零调用；探测报错 |
| C7 | 该做成 hook 的规则；已死的 hook | 散文里的“总是/绝不”规则；零触发的 hook |
| C8 | 应该沉淀为技能的重复劳动 | 同一形态任务 30 天内出现 3 次以上 |
| C9 | 子智能体开销过重的运行 | 子智能体占单次运行 token 超过 60% |
| C10 | 权限白名单过窄 | 日常高频命令不在 `allow` 中 |
| C11 | 形同虚设的设置 | 键落在不被读取的层、被遮蔽的命令/技能、孤儿记忆文件 |

技能里还有一张“症状索引”，把用户的抱怨（“老是上下文不够”、“老是问我要权限”、
“它不听我的规则”）映射到能解释该症状的检查项。

### 文件

```
assets/skills/ai-usage-review/
  SKILL.md                 工作流：定范围 → 采集 → 诊断 → 报告 → 落地
  references/
    playbook.md            11 项检查：信号、阈值、修复、如何估算节省
    authoring.md           如何构建修复方案：skill / hook / 子智能体 / CLAUDE.md 怎么选
```

`SKILL.md` 刻意保持简短 —— 技能正文一旦加载，就会在该回合剩余部分一直留在上下文里。
两份 reference 仅在需要时才读取。
