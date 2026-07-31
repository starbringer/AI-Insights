# AI Insights

[English](README.md) | **简体中文**

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-yellow)](https://buymeacoffee.com/starbringer)

<p align="center">
  <img src="assets/social-preview.png" alt="AI Insights —— 了解并改进你使用 AI 编程工具的方式" width="840">
</p>

一个本地 Web 应用，把 AI 编程工具的原始使用数据变成实时仪表盘 —— token 用量、成本、
会话历史、配置健康度。

- **仪表盘** —— 看清你的 token 和钱到底花在哪
- **内置 MCP 服务器** —— 33 个只读工具，让你的 AI 助手读到同一份数据
- **`ai-usage-review` 技能** —— 把数据变成有排序、有证据支撑的优化建议
- **`ai-change-impact` 技能** —— 用美元衡量一次改进到底省下了多少
- **与具体工具解耦** —— 目前解析 Claude Code 的 JSONL 转录文件，后续可接入其他数据源

**隐私**

| | |
|---|---|
| **应用本身** | 从不调用 AI 模型。不需要 API key，不依赖外部服务，不上报遥测 —— 你的转录文件不会离开本机。解析、token 计数和各项检查都是本地的确定性计算 |
| **技能** | 唯一用到 AI 的部分。它们运行在**你自己的** AI 助手里，消耗的是**它的** token；本应用只是通过 MCP 把本地数据交给它们 |

> 应用界面本身仅提供英文，本文档为中文版说明。

![Dashboard](docs/screenshots/01-dashboard.png)

---

## 环境要求

| | |
|---|---|
| 运行时 | [Bun](https://bun.sh) ≥ 1.1（在 1.3.13 上测试通过） |
| 系统 | Windows、macOS 或 Linux —— 服务端行为完全一致；自动打开浏览器按平台选用 `open` / `cmd /c start` / `xdg-open`，命令不存在时静默跳过 |
| 数据 | **Claude Code** 转录文件，位于 `~/.claude/projects/`（*目前唯一内置的数据源*） |

## 安装与启动

**1. 安装 Bun** —— macOS / Linux：

```bash
curl -fsSL https://bun.sh/install | bash
```

Windows：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**2. 拉取代码：**

```bash
git clone https://github.com/starbringer/ai-insights.git
```

```bash
cd ai-insights
```

**3. 安装依赖：**

```bash
bun install
```

**4. 运行：**

```bash
bun run start
```

浏览器会自动打开 **http://localhost:5757** —— 否则请手动访问。

这一条命令会幂等地装好四样东西：

- **应用本身** —— 仪表盘、文件监听器与 HTTP API
- **MCP 服务器** —— 在 `http://127.0.0.1:5757/mcp` 提供服务，并注册到检测到的每个 AI 工具
- **`ai-usage-review` 技能** —— 安装到检测到的每个 AI 工具
- **`ai-change-impact` 技能** —— 安装到检测到的每个 AI 工具

重启一次 AI 工具让它读到这些，然后运行 `/ai-usage-review`。
用 `--no-provision` 可关闭。

---

## 功能

*下方截图取自真实使用记录，其中所有项目名、路径、会话内容和配置名称都被替换成了一致的
替身数据 —— 详见 [docs/screenshots/](docs/screenshots/)。*

### MCP 服务器

仪表盘展示的一切，都以运行在应用自身端口上的 33 个**只读**工具提供给你的 AI 助手 ——
覆盖用量、改进效果与 harness 配置。没有任何写操作：你接受的改动，由助手用其自身
受权限管控的编辑工具落地。

全部工具、其他客户端（含 stdio）以及刻意未暴露的部分，见
**[docs/mcp.zh-CN.md](docs/mcp.zh-CN.md)**。

### 技能

两个内置技能消费这些工具：

- **`ai-usage-review`** —— 把数字变成有排序、有证据支撑的改进项
- **`ai-change-impact`** —— 用美元衡量一次改动实际省下了多少

如何调用及示例，见 **[docs/skills.zh-CN.md](docs/skills.zh-CN.md)**。

### Dashboard（仪表盘）

KPI 卡片、按输入/输出/缓存拆分的 token 趋势，以及按模型、项目、MCP 服务器和 skill 的
分项统计。

![Dashboard charts](docs/screenshots/02-dashboard-charts.png)

### Runs（运行列表）

列出每一次记录到的会话，支持搜索与过滤。每一行的运行 ID 就是交给
`ai-change-impact` 对比两次会话时用的那个。

![Runs](docs/screenshots/03-runs.png)

一个 **run**（运行）是一次逻辑会话 → 包含一个或多个 **agent**（各对应一个转录文件）
→ 包含若干 **turn**（各对应一次 API 调用）。[数据模型详解](docs/data-model.zh-CN.md#run--agent--turn)。

### 运行详情

单次会话的三栏回放：按顺序呈现提示词、LLM 调用、工具与 MCP 调用、hook 触发、
子智能体派生、上下文压缩与错误。

![Run detail — session tree](docs/screenshots/04-run-detail-tree.png)

第二个标签页拆解该次运行的成本，其中的调优建议算自本次运行的真实数字，而非通用规则。

![Run detail — usage](docs/screenshots/05-run-detail-usage.png)

### Harness（配置面）

查看 —— 在安全的前提下也可编辑 —— 当前工具的配置。每个标签页只在当前 provider
支持该能力时出现。

**CLAUDE.md** —— 该工具注入的每一个指令文件，带内嵌编辑器。

![CLAUDE.md](docs/screenshots/06-claudemd.png)

**Commands（命令）** —— 汇总用户、项目与插件三个来源的斜杠命令，并做覆盖检测，
让你看清最终生效的是哪个定义。

![Commands](docs/screenshots/07-commands.png)

**Skills（技能）** —— 成本、实际记录的调用次数、触发分析器，以及该 skill 与哪些
hook、服务器和命令相连。

![Skills](docs/screenshots/08-skills.png)

**Hooks** —— 所有配置层中的每个 hook。触发次数来自事件流记录，不是估算。

![Hooks](docs/screenshots/09-hooks.png)

对于运行脚本文件的动作，会在磁盘上解析出对应文件 —— 点击即可阅读、编辑并保存。

![Hook script editor](docs/screenshots/10-hooks-script.png)

**MCP** —— 作用域、传输方式、探测状态、注入量估算，以及可展开的工具 schema。
服务器只从配置文件读取，绝不执行 ——
[原因](docs/architecture.zh-CN.md#mcp-为什么读配置文件而不用-cli)。

![MCP](docs/screenshots/11-mcp.png)

**Permissions（权限）** —— 跨层规则合并为最终生效集合，被遮蔽的规则以删除线标出。

![Permissions](docs/screenshots/12-permissions.png)

**Memory（记忆）** —— MEMORY.md 索引与每个主题文件，对索引未引用的文件标注
**orphan**（孤儿）徽标。

![Memory](docs/screenshots/13-memory.png)

**Configs（生效配置）** —— 各设置层合并后的视图，并对写在该工具根本不读取的层中的
键给出告警。

![Effective Configs](docs/screenshots/15-configs.png)

### Settings（设置）

Harness 状态标记所用的告警阈值、数据保留，以及驱动应用内全部成本数字的分模型参考价格。

![Settings](docs/screenshots/16-settings.png)

### 主题与数据源

主题选择会被保存，且图表原地换肤。**Source ▾** 列出所有已注册的 provider 并标注
哪些有数据。

![Dark theme](docs/screenshots/17-dashboard-dark.png)

每个界面的完整控件说明见 **[docs/ui.zh-CN.md](docs/ui.zh-CN.md)**。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/cli.zh-CN.md](docs/cli.zh-CN.md) | 命令行参数、环境变量、脚本命令、独立可执行文件 |
| [docs/storage.zh-CN.md](docs/storage.zh-CN.md) | 缓存、重建缓存，以及数据保留窗口 |
| [docs/ui.zh-CN.md](docs/ui.zh-CN.md) | 每个界面及其控件，附截图 |
| [docs/skills.zh-CN.md](docs/skills.zh-CN.md) | 两个技能：如何调用、示例，以及「复盘 → 落地 → 验证」闭环 |
| [docs/mcp.zh-CN.md](docs/mcp.zh-CN.md) | MCP 服务器：安装、全部工具、其他客户端、未暴露的部分、安全 |
| [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) | 两个扩展接缝、Claude Code 适配器、如何接入新工具、MCP 服务器、自动装配、MCP 探测、写入安全、网络绑定 |
| [docs/data-model.zh-CN.md](docs/data-model.zh-CN.md) | Run / Agent / Turn、准确性与去重说明、数据库 schema、成本估算 |
| [docs/api.zh-CN.md](docs/api.zh-CN.md) | 全部 HTTP 接口，以及它们通用的 `?provider=` 选择器 |
| [docs/screenshots/](docs/screenshots/) | 全部 UI 截图及其脱敏方式（[中文说明](docs/screenshots/README.zh-CN.md)） |

## 项目结构

```
server.ts                  入口，Hono 应用，监听器启动，provider 扫描循环，自动装配
mcp-stdio.ts               stdio 方式的 MCP 服务器，供无法使用 HTTP 的客户端
src/
  paths.ts                 所有路径常量
  provision.ts             与 provider 无关的启动装配（技能 + MCP 注册）
  db.ts                    SQLite 初始化（bun:sqlite，WAL 模式）
  tokenizer.ts             js-tiktoken 封装
  pricing.ts               分模型价格表 + computeCost()
  thresholds.ts            可配置的告警阈值
  retention.ts             数据保留窗口：设置、截止时间、清理、每小时扫描
  providers/
    types.ts               Provider 接口 + NormalizedTurn 结构
    index.ts               Provider 注册表，providerForPath / providerById 查找
    claude-code/           自包含的 Claude Code 适配器
      index.ts             导出 claudeCodeProvider 对象
      parser.ts            增量 JSONL 解析、message.id 去重、分类桶归类
      agentDetail.ts       读取 JSONL 并输出 NormalizedTurn[]
      agentTree.ts         把转录 DAG 折叠成可直接渲染的会话树
      titles.ts            智能体标题提取（剥离包装标签）
      config/              Claude Code 的 ToolConfigAdapter（Harness 标签页）
        index.ts           组装适配器 + 能力标志
        shared.ts          项目发现、插件枚举、覆盖优先级排序
        instructions.ts    CLAUDE.md 枚举 + 白名单读写 + 注入量序列
        commands.ts        三来源命令扫描、命名空间、增删改
        skills.ts          三来源 skill 扫描、触发分析、实际使用记录
        hooks.ts           跨配置层的 hook、脚本解析、触发次数
        mcp.ts             从配置文件枚举 MCP + 工具/schema 探测 + 诊断
        permissions.ts     规则解析 + 层合并 + 覆盖标记
        memory.ts          按项目的记忆库（MEMORY.md 索引 + 主题）
        effective.ts       合并后的设置层 + 层限制告警
        provision.ts       技能安装 + `claude mcp add` 注册
  config/
    types.ts               ToolConfigAdapter 接口 + 中性配置结构
    index.ts               配置适配器注册表（与 provider 注册表平行）
    graph.ts               与 provider 无关的依赖图构建器（为「关联组件」提供数据）
    snapshots.ts           harness 指纹日志：采集、比对、变更时间线
  transcripts/
    cache.ts               通用 SQLite 读写辅助函数（与 provider 无关）
    aggregate.ts           SQL 聚合查询（总量、序列、智能体、模型、项目）
    runs.ts                run id 解析、活跃度重算、运行列表/加载
    usageReport.ts         单次运行的用量拆解（分类桶、分模型成本、建议）
    runKey.ts              推导得到的、与 provider 无关的运行 ID + 前缀解析
    window.ts              带结束边界的时间窗口 + 数据保留守卫
    compare.ts             运行间与时间段间的对比、成因归因
  watcher.ts               chokidar 监听器 → 把变更派发给所属 provider
  mcp/
    tools.ts               MCP 工具注册表 —— 只读、支持 provider 选择
    protocol.ts            与传输无关的 JSON-RPC / MCP 分发
  api/
    providerParam.ts       共享的 ?provider= 解析（HTTP + MCP）
    settingsEndpoints.ts   阈值 + 数据保留（读写）+ 价格（只读）
    transcriptEndpoints.ts 用量数据：统计、时间序列、运行、智能体、树、用量报告
    configEndpoints.ts     /api/config/* —— Harness 标签页
    providersEndpoint.ts   GET /api/providers
    mcpEndpoint.ts         POST /mcp（streamable HTTP）+ GET /api/mcp-server
static/
  index.html               侧边栏 SPA 外壳（11 个标签页 + 会话详情浮层）
  favicon.svg              浏览器标签页图标，为 16px 下的可辨识度做了扁平化
  style.css                拟物柔和 UI 主题 —— 浅色 + 深色，CSS 变量
  config.css               Harness 标签页 + 运行 Usage 视图的样式
  app.js                   数据请求、ECharts、主题切换、会话树渲染、运行 Usage 视图
  config.js                Harness 标签页（claudemd/commands/skills/hooks/mcp/permissions/memory/configs）+ 共享的依赖集群渲染器
  lib/
    echarts.min.js         Apache ECharts 5.5.1（离线，1007KB）
assets/
  icon.svg                 主图标源文件，512×512（static/favicon.svg 是 32px 版本）
  social-preview.png       GitHub 社交预览图，1280×640 —— 由同目录的 .html 渲染生成
  skills/
    ai-usage-review/       用量复盘技能，安装到每个已检测的 AI 工具
    ai-change-impact/      前后效果测量技能，安装方式相同
      SKILL.md             工作流：定范围 → 采集 → 诊断 → 报告 → 落地
      references/          11 项检查，以及 skill/hook/子智能体的撰写指南
docs/                      架构、数据模型、API 与 MCP 参考、截图（中英双语）
data/                      SQLite 数据库存放处（已 git-ignore）
```

## 许可证

MIT —— 见 [LICENSE](LICENSE)。

---

## ☕ 支持这个项目

如果这个仪表盘帮你理解（或者控制住）了 LLM 的 token 开销，欢迎请我喝杯咖啡。

**[☕ Buy Me a Coffee](https://buymeacoffee.com/starbringer)**

不用有压力 —— 这个软件现在是、将来也一直会是免费的。
