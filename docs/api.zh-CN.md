# HTTP API

[English](api.md) | **简体中文**

UI 的所有操作都经由这些路由，因此它们同时也是可供脚本使用的本地 API。服务器默认只
监听回环地址（见[架构 › 网络绑定](architecture.zh-CN.md#网络绑定)）。

所有响应均为 JSON。出错时返回 `{ "error": "…" }` 并带 4xx/5xx 状态码；当前 provider
的适配器未实现某项能力时，对应的 config 路由返回 `501`。

## Providers

| 路由 | 说明 |
|---|---|
| `GET /api/providers` | 已注册的 provider 列表，附实时 `hasData` 标志 |

**所有读取类路由都接受 `?provider=<id>`** 来选择数据源：

| 取值 | 含义 |
|---|---|
| *省略* | 默认 provider —— 第一个已注册的（当前为 `claude-code`） |
| `<id>` | 仅该 provider |
| `all` | 不过滤：跨所有已注册 provider 汇总 |
| 其他 | 返回 `400`，并在消息中列出合法的 id |

在 `/api/config/*` 上，`all` 会退化为默认适配器 —— 配置本身就是按工具划分的。按 id
定位单个运行或智能体的路由会从记录本身解析其所属 provider；那里的 `?provider=` 仅作
断言，不匹配时返回 `404`。

## 使用数据

标注 *ranged* 的路由接受 `?range=`，取值为 `1h`、`24h` 或 N 天（`7d`、`14d`、`30d` 等）。
分桶粒度自适应：`1h` 用 5 分钟切片，`24h` 与不超过 3 天的天数范围用小时，其余按天。

range 的默认值就是[数据保留窗口](#设置)，并被它截断：更早的记录已被删除，因此在 30 天
保留设置下请求 `?range=90d` 只会按 `30d` 作答，而不会假装能看得更远。

| 路由 | 说明 |
|---|---|
| `GET /api/stats` | KPI 总量：`retentionDays`、`today`、`sevenDays`（窗口 ≤ 7 天时为 `null`）、`window`（整个保留窗口的总量）、`cacheHitRatePct`、`activeRuns` |
| `GET /api/timeseries` | *ranged* —— token 趋势（输入 / 输出 / 缓存写入 / 缓存读取）。不带 `?range=` 时，`?days=N` 返回按天分桶的数据，上限为保留窗口 |
| `GET /api/models` | *ranged* —— 按模型的总量 |
| `GET /api/projects` | *ranged* —— 按项目工作目录的总量，含运行数与智能体数 |
| `GET /api/runs` | 分页的运行列表；`?limit=`、`?offset=`、`?search=`、`?project=` |
| `GET /api/run/:runId` | 单次运行及其智能体 |
| `GET /api/run/:runId/usage` | 单次运行的成本拆解：分类桶、按模型汇总、累计序列、调优建议 |
| `GET /api/top-runs` | *ranged* —— 按 token 排序的 Top 运行 |
| `GET /api/top-turns` | *ranged* —— 开销最大的单次 API 调用 |
| `GET /api/mcp-usage` | *ranged* —— 每个 MCP 服务器的估算 token，含按工具拆分 |
| `GET /api/skill-usage` | *ranged* —— 每次 skill 调用的估算 token |
| `GET /api/agents` | 智能体列表 |
| `GET /api/agent/:agentId` | 单个智能体的扁平归一化回合 |
| `GET /api/agent/:agentId/tree` | 运行详情页所需的、可直接渲染的会话树 |

## 配置（Harness）

| 路由 | 说明 |
|---|---|
| `GET /api/config/capabilities` | 当前适配器支持哪些能力 —— 决定显示哪些标签页 |
| `GET /api/config/projects` | 从转录记录中发现的项目目录（供作用域选择器使用） |
| `GET /api/config/instructions` | 指令文件 + 注入 token 序列。`injection` 带有保留窗口内的 `windowDays`、`agentCount` 与 `estimatedInjectedTokens` |
| `GET /api/config/instructions/file?path=` | 原始文件内容 |
| `PUT /api/config/instructions/file` | 写入一个已枚举的指令文件 |
| `GET /api/config/commands` | 所有来源的斜杠命令，带覆盖标记 |
| `PUT /api/config/commands/file` | 写入一个可编辑的命令文件 |
| `POST /api/config/commands` | 创建命令 |
| `DELETE /api/config/commands` | 删除一个可编辑的命令 |
| `GET /api/config/skills` | skill 列表，含触发词、token 成本与保留窗口内的实际使用记录（`calls` / `estTokens`） |
| `PUT /api/config/skills/file` | 写入一个可编辑的 SKILL.md |
| `GET /api/config/hooks` | 跨配置层的 hook 条目 + 实际触发次数（`entries[].fires`、`totalFires`、`windowDays`） |
| `GET /api/config/hooks/script?path=` | 读取某个 hook 的脚本文件 |
| `PUT /api/config/hooks/script` | 写入某个 hook 的脚本文件 |
| `DELETE /api/config/hooks` | 从设置文件中移除一个 hook 条目 |
| `GET /api/config/permissions` | 合并后的 allow/deny/ask 规则；`?project=` 可加入项目层 |
| `GET /api/config/mcp` | MCP 服务器、探测状态、工具、schema、诊断，以及用于注入量估算的 `agents` / `windowDays` |
| `GET /api/config/memory` | 按项目的记忆库 |
| `GET /api/config/effective` | 合并后的设置层；`?project=` 选择项目层。Claude Code 会累加而非覆盖的键（`permissions.allow` / `deny` / `ask`）返回各层规则的拼接结果，并带 `mergedLevels` 而非 `overriddenLevels` |
| `GET /api/config/dependencies` | 依赖图：节点、边、依赖链、统计。为 Skills 与 MCP 标签页的「关联组件」提供数据 |

写入类路由只接受对应列表接口枚举过的路径 —— 见
[架构 › 写入安全](architecture.zh-CN.md#写入安全)。

## 设置

| 路由 | 说明 |
|---|---|
| `GET /api/settings/thresholds` · `PUT /api/settings/thresholds` | Harness 标签页上 ok/warn/error 状态标记所用的告警/错误阈值。`PUT` 只合并你传入的键，并写入 `data/thresholds.json` |
| `GET /api/settings/retention` · `PUT /api/settings/retention` | 保留多少天的记录。`GET` 返回 `{ retentionDays, defaultDays, minDays, maxDays }`；`PUT { retentionDays }` 会截断到 1–365，写入 `data/retention.json`，并返回 `{ retentionDays, previousDays, rescanned, pruned }`。调小会立即清理超出部分；调大会清空解析偏移并重新扫描全部转录文件，因此响应可能需要几秒 |
| `GET /api/settings/pricing` | 驱动应用内全部成本数字的分模型参考价格。HTTP 接口只读 —— 如需修改请编辑 `data/pricing.json` |

## MCP

| 路由 | 说明 |
|---|---|
| `POST /mcp` | Model Context Protocol 端点，streamable HTTP 传输。无状态：一条 JSON-RPC 消息进、一个 `application/json` 响应出；通知类消息返回 `202` |
| `GET /mcp` · `DELETE /mcp` | `405` —— 不提供服务端主动推送的 SSE 流，也没有会话需要终止 |
| `GET /api/mcp-server` | 人类可读摘要：协议版本、工具数量，以及每个工具的名称与说明 |

`POST /mcp` 会以 `403` 拒绝非回环的 `Origin` 头（防御 DNS 重绑定攻击），以 `400` 拒绝
不受支持的 `MCP-Protocol-Version` 头。这些工具全部只读，且接受与上述路由相同的
`provider` 参数 —— 见 [docs/mcp.zh-CN.md](mcp.zh-CN.md)。
