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

所有 `/api/config/*` 路由都接受 `?provider=<id>` 来指定目标工具（默认使用当前/第一个
provider）。

## 使用数据

标注 *ranged* 的路由接受 `?range=1h\|24h\|7d\|30d`。分桶粒度自适应：`1h` 用 5 分钟切片，
`24h` 用小时，其余按天。

| 路由 | 说明 |
|---|---|
| `GET /api/stats` | KPI 总量：今日、7 天、30 天、缓存命中率、活跃运行数 |
| `GET /api/timeseries` | *ranged* —— token 趋势（输入 / 输出 / 缓存写入 / 缓存读取） |
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
| `GET /api/config/instructions` | 指令文件 + 注入 token 序列 |
| `GET /api/config/instructions/file?path=` | 原始文件内容 |
| `PUT /api/config/instructions/file` | 写入一个已枚举的指令文件 |
| `GET /api/config/commands` | 所有来源的斜杠命令，带覆盖标记 |
| `PUT /api/config/commands/file` | 写入一个可编辑的命令文件 |
| `POST /api/config/commands` | 创建命令 |
| `DELETE /api/config/commands` | 删除一个可编辑的命令 |
| `GET /api/config/skills` | skill 列表，含触发词、token 成本与实际使用记录 |
| `PUT /api/config/skills/file` | 写入一个可编辑的 SKILL.md |
| `GET /api/config/hooks` | 跨配置层的 hook 条目 + 实际触发次数 |
| `GET /api/config/hooks/script?path=` | 读取某个 hook 的脚本文件 |
| `PUT /api/config/hooks/script` | 写入某个 hook 的脚本文件 |
| `DELETE /api/config/hooks` | 从设置文件中移除一个 hook 条目 |
| `GET /api/config/permissions` | 合并后的 allow/deny/ask 规则；`?project=` 可加入项目层 |
| `GET /api/config/mcp` | MCP 服务器、探测状态、工具、schema、诊断 |
| `GET /api/config/memory` | 按项目的记忆库 |
| `GET /api/config/effective` | 合并后的设置层；`?project=` 选择项目层 |
| `GET /api/config/dependencies` | 依赖图：节点、边、工作流链、统计 |

写入类路由只接受对应列表接口枚举过的路径 —— 见
[架构 › 写入安全](architecture.zh-CN.md#写入安全)。

## 设置

| 路由 | 说明 |
|---|---|
| `GET /api/settings/thresholds` · `PUT /api/settings/thresholds` | Harness 标签页上 ok/warn/error 状态标记所用的告警/错误阈值。`PUT` 只合并你传入的键，并写入 `data/thresholds.json` |
| `GET /api/settings/pricing` | 驱动应用内全部成本数字的分模型参考价格。HTTP 接口只读 —— 如需修改请编辑 `data/pricing.json` |
