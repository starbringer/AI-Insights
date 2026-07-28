# 截图

[English](README.md) | **简体中文**

应用的每一个页面，均以 1500×980 分辨率（2× 设备像素比）截取。

**图中所有数据均已脱敏。** 截图工具在 UI 渲染之前拦截每一个 `/api/*` 响应，把个人内容
替换成形态逼真的替身数据，因此这里不会泄露任何真实项目或对话：

| 敏感内容 | 显示为 |
|---|---|
| 项目目录（`X:\...\my-project`） | `C:\dev\acme-web`、`C:\dev\api-service`… |
| 主目录 / 系统用户名 | `C:\Users\dev` |
| 运行标题 | 中性的工程类标题（"Refactor the settings module"） |
| 提示词、输出、思考与工具结果文本 | 形态和长度相同的生成填充文本 |
| skill / 命令 / MCP 服务器 / MCP 工具名称 | `code-reviewer`、`deploy`、`weather`、`weather_op_3`… |
| hook 脚本文件名 | `format-on-save.ps1`、`notify-done.ps1`… |
| 记忆主题及其内容 | `build-pipeline-notes`、填充正文 |
| 权限规则限定符 | `Bash(npm run build:*)`、`Read(src/**)`… |
| 依赖链名称 | `research`、`release`… |
| 残留的绝对路径、邮箱 | `C:\dev\workspace\file.ext`、`dev@example.com` |

映射是确定性的（同一个真实值始终对应同一个替身），因此交叉引用 —— 比如依赖图中
提到的某个 skill，或同时出现在 Runs 表格和图表里的某个项目 —— 在各页面之间保持一致。

Token 计数、成本、时间戳、模型名称以及全部结构性元数据都是真实的。

| 文件 | 页面 |
|---|---|
| `01-dashboard.png` | Dashboard —— KPI 卡片与 token 趋势 |
| `02-dashboard-charts.png` | Dashboard —— 模型 / 项目 / MCP / skill 用量、缓存命中率、模型占比、Top 运行 |
| `03-runs.png` | Runs 列表 |
| `04-run-detail-tree.png` | 运行详情 —— 会话树（Tree 视图） |
| `05-run-detail-usage.png` | 运行详情 —— 成本拆解（Usage 视图） |
| `06-claudemd.png` | CLAUDE.md —— 指令文件、注入时间线、编辑器 |
| `07-commands.png` | Commands —— 跨用户 / 项目 / 插件来源的斜杠命令 |
| `08-skills.png` | Skills —— 列表 + 详情，含触发分析、关联组件与编辑器 |
| `09-hooks.png` | Hooks —— 跨配置层的条目及实际触发次数 |
| `10-hooks-script.png` | Hooks —— hook 脚本查看器 / 编辑器 |
| `11-mcp.png` | MCP —— 服务器、探测状态、工具与 schema token 成本 |
| `12-permissions.png` | Permissions —— allow/deny/ask 规则及层级覆盖 |
| `13-memory.png` | Memory —— 按项目的记忆库 |
| `15-configs.png` | Effective Configs —— 合并后的设置层 |
| `16-settings.png` | Settings —— 阈值与价格 |
| `17-dashboard-dark.png` | 深色主题下的 Dashboard |
