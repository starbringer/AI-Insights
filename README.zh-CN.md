# AI Insights

[English](README.md) | **简体中文**

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-yellow)](https://buymeacoffee.com/starbringer)

了解并改进你使用 AI 编程工具的方式。这是一个本地 Web 应用，把原始使用数据变成实时仪表盘 —— token 用量、成本、会话历史与配置健康度。

目前它解析 **Claude Code 的 JSONL 转录文件**。架构与具体工具解耦，后续可以接入其他数据源。

**不调用 AI。不依赖外部服务。所有数据都留在你自己的机器上。**

> 应用界面本身仅提供英文，本文档为中文版说明。

![Dashboard](docs/screenshots/01-dashboard.png)

---

## 环境要求

- [Bun](https://bun.sh) ≥ 1.1（在 1.3.13 上测试通过）
- **Windows、macOS 或 Linux。** 只有"自动打开浏览器"这一步是 Windows 专用的（它调用 `cmd /c start`）；其他平台服务端行为完全相同，只需自己打开地址。
- 至少一个受支持的数据源 —— **Claude Code**，数据位于 `~/.claude/projects/`（*目前唯一内置的数据源*）

## 安装与启动

### 1. 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

验证：`bun --version`

### 2. 获取代码

```bash
git clone https://github.com/starbringer/ai-insights.git
cd ai-insights
```

### 3. 安装依赖

```bash
bun install
```

### 4. 启动应用

```bash
bun run start
```

### 5. 打开页面

在 Windows 上浏览器会自动打开；其他平台请访问 **http://localhost:5757**。

首次启动时，应用会扫描 `~/.claude/projects/` 下的所有转录文件，构建
`data/cache.db`，随后持续监听这些文件 —— 新产生的活动会在几秒内出现，无需重启。
历史记录较多时扫描需要几秒；首轮扫描完成后页面即可使用。

如果还没有任何数据，应用仍会正常加载，并告诉你它期望在哪里找到数据。

### 命令行参数

```bash
bun run server.ts --port=8080 --no-browser
```

| 参数 | 说明 |
|------|------|
| `--port=N` | 监听端口 N（默认 `5757`） |
| `--host=H` | 绑定地址（默认 `127.0.0.1`）—— 配置 API 可以写文件，因此默认只监听回环地址，除非你主动改成 `0.0.0.0`。[原因](docs/architecture.zh-CN.md#网络绑定) |
| `--no-browser` | 不自动打开浏览器 |
| `--static-only` | 跳过文件监听（以及浏览器）—— 启动扫描仍会执行，但之后的变更要重启才会被读取 |

环境变量 `PORT` 和 `HOST` 同样有效。

### 脚本命令

```bash
bun run start        # 启动服务（等价于 bun run server.ts）
bun run dev          # --watch 热重载
bun run typecheck    # tsc --noEmit
bun run test         # 单元测试
bun run build        # 编译为 dist/ai-insights.exe（Windows x64）
```

### 重建缓存

数据库只是缓存 —— JSONL 转录文件才是唯一的事实来源。
删除 `data/cache.db` 后重启即可强制全量重新解析。当版本更新导致 schema 版本变化时，
应用会自动执行同样的重建。

### 独立可执行文件

```bash
bun run build        # → dist/ai-insights.exe（约 60MB，无需安装 Bun）
```

该二进制内嵌了 Bun 运行时；分发时请把 `static/` 目录一并附上。`build` 脚本面向
Windows x64 —— 在 macOS/Linux 上可以直接跑源码，或改用目标平台：
`bun build --compile --target=bun-<darwin|linux>-x64 server.ts --outfile dist/ai-insights`。

---

## 功能

*下方截图取自真实使用记录，其中所有项目名、路径、会话内容和配置名称都被替换成了
一致的替身数据 —— 详见 [docs/screenshots/](docs/screenshots/)。*

### Dashboard（仪表盘）

五张 KPI 卡片（今日 / 7 天 / 30 天总量，含 API 等价成本、缓存命中率、活跃运行数），
下方是按输入、输出、缓存写入、缓存读取拆分的 token 趋势图。

再往下：按模型统计的用量、Top 项目、**MCP token 用量**（流经每个服务器工具调用的
token，带按工具的 tooltip）、**skill token 用量**、带 50% 参考线的**缓存命中率**、
**模型占比**，以及 **Top 10 运行** —— 点击任意柱状条即可直接跳进该运行。

![Dashboard charts](docs/screenshots/02-dashboard-charts.png)

每个图表都有独立的时间范围切换（`1h` / `24h` / `7d` / `30d`），并会记住你的选择。
成本是基于可编辑价格表算出的 API 等价参考值，不是账单；[详见此处](docs/data-model.zh-CN.md#成本估算)。

### Runs（运行列表）

列出每一次记录到的会话，包含标题、项目、智能体数量（运行派生了子智能体时显示
`× N`）、回合数、token 总量和最后活跃时间。支持搜索，也可按项目过滤。

![Runs](docs/screenshots/03-runs.png)

一个 **run**（运行）是一次逻辑会话，包含一个或多个 **agent**（智能体，各对应一个
转录文件），每个智能体又包含若干 **turn**（回合，各对应一次 API 调用）。
[数据模型详解](docs/data-model.zh-CN.md#run--agent--turn)。

### 运行详情 —— 会话树

在任意运行上点 **View**，即可用三栏视图回放整个会话：左侧是智能体列表，中间是树，
右侧是节点完整详情。

![Run detail — session tree](docs/screenshots/04-run-detail-tree.png)

每个智能体各有一棵树，堆叠在同一个可滚动视图中。主干是按时间顺序的流程 —— 提示词、
LLM 调用、hook 触发、上下文压缩、错误 —— 每次 LLM 调用可展开为它的思考过程、文本
输出，以及按顺序排列的每一次工具调用：普通工具 ⚙、MCP 调用 ⇄、子智能体派生 ◈
（附 `tree ↓` 跳转链接）、skill 调用 ❖（注入的 skill 正文嵌套在下方）。框架事件也是
一等节点：`⚡` hook（含命令与耗时）、`✕` API 错误与限流重试、`▣` 上下文压缩（含压缩
前后 token 数）、`⤷` 模型拒绝回退、`✚` 注入的上下文。提示词编辑和重试产生的废弃分支
会折叠成 `⎇` 子树，让主干保持清晰。

顶栏汇总整场会话：提示词、LLM 调用、工具、MCP、子智能体、hook、错误、压缩、分支。
窄屏时两侧面板会收进顶栏的切换按钮。

### 运行详情 —— 用量

中间栏的第二个标签页是该次运行的成本拆解，使用与仪表盘相同的去重数据计算。

![Run detail — usage](docs/screenshots/05-run-detail-usage.png)

包含 KPI 卡片、**按分类的成本环形图**（基础 / MCP / skill / 子智能体 —— 每次 API 调用
在解析时就根据其工具调用完成分类）、累计花费曲线、按模型的表格，以及基于本次运行
真实数字得出的**调优建议**，例如"改用更便宜的模型重新计价可省 $X（Y%）"、缓存命中率
偏低的告警，或子智能体占比过高的提示。

### Harness（配置面）

**Harness** 分组用于查看 —— 在安全的前提下也可编辑 —— 当前工具的配置。每个标签页
只在当前 provider 支持该能力时才出现，因此未来接入其他工具的适配器只会少显示几个
标签页。

其中大多数标签页共用同一种布局：左侧列表列，右侧详情列，各自独立滚动。

#### CLAUDE.md

列出该工具注入的每一个指令文件：全局的 `~/.claude/CLAUDE.md`，以及你的转录记录涉及
过的每个项目的 `CLAUDE.md` / `.claude/CLAUDE.md`（缺失的会标为可创建）。提供每个文件
的 token 与词数统计、带 **Save** 的内嵌编辑器，以及按天的注入 token 时间线。

![CLAUDE.md](docs/screenshots/06-claudemd.png)

#### Commands（命令）

汇总三个来源的斜杠命令 —— 用户、项目和已启用的插件 —— 支持 `:` 命名空间、参数提示、
`$ARGUMENTS` 检测、token 成本、搜索，以及**同名覆盖检测**，让你看清最终生效的是哪个
定义。用户/项目命令可编辑、创建和删除；插件命令为只读。

![Commands](docs/screenshots/07-commands.png)

#### Skills（技能）

左侧窄列表，右侧完整详情：覆盖检测、SKILL.md 的 token 成本、`references/` 与
`scripts/` 清单、30 天内**实际记录**的调用次数与注入 token，以及展示哪些提示词关键词
会触发该 skill 的**触发分析器**。

![Skills](docs/screenshots/08-skills.png)

#### Hooks

列出所有配置层中的每个 hook，包含其 matcher、动作类型，以及最近 30 天的**实际触发
次数** —— 该数字来自事件流记录，不是估算。

![Hooks](docs/screenshots/09-hooks.png)

对于运行脚本文件（`.ps1`、`.sh`、`.py` 等）的动作，会在磁盘上解析出对应文件：点击即可
阅读、编辑并保存脚本。hook 也可以删除 —— 删除只移除设置文件中的条目，脚本文件本身
保留在磁盘上。

![Hook script editor](docs/screenshots/10-hooks-script.png)

#### MCP

左侧是服务器列表，含作用域、传输方式和工具数量；右侧是启动命令、来源文件、探测状态、
30 天注入量估算，以及可展开的工具列表（含描述与 JSON schema）。诊断信息在默认面板中，
重新探测按钮可绕过 10 分钟缓存。

![MCP](docs/screenshots/11-mcp.png)

服务器是从配置文件而非 CLI 枚举出来的；你尚未批准的项目级服务器会被列出，但绝不会被
执行 —— [原因](docs/architecture.zh-CN.md#mcp-为什么读配置文件而不用-cli)。

#### Permissions（权限）

把 `allow` / `deny` / `ask` 规则解析为工具 + 限定符，覆盖用户层，并可通过项目选择器
加入某个项目的设置与本地设置。页面展示合并后的最终生效集合；被更高优先级层遮蔽的
规则会以删除线标出。

![Permissions](docs/screenshots/12-permissions.png)

#### Memory（记忆）

按项目查看持久化记忆库：MEMORY.md 索引、每个主题文件及其内容、大小和最后修改时间，
对存在但未被索引引用的文件标注 **orphan**（孤儿）徽标。

![Memory](docs/screenshots/13-memory.png)

#### Workflow（工作流）

跨 skill、hook、MCP 服务器和命令的依赖分析。左栏列出检测到的**工作流** —— 即按
hook → MCP → skill → command 排序的连通分量 —— 选中其一即可渲染该工作流的图，边带
标签（实线 = 某个组件在内容中按名称引用了另一个，虚线 = 关键词相似），并附带编号步骤。

![Workflow](docs/screenshots/14-workflow.png)

#### Configs（生效配置）

各设置层合并后的只读视图：顶部卡片显示**默认模型**及其来源层、努力级别，以及根据你
真实转录记录得出的最近 7 天最常用模型。下方列出每个键的最终生效值、它覆盖了哪些层，
并对设置在该工具根本不会读取的层中的键给出告警。

![Effective Configs](docs/screenshots/15-configs.png)

### Settings（设置）

审计 API 使用的告警阈值，以及驱动应用内全部成本数字的分模型参考价格。

![Settings](docs/screenshots/16-settings.png)

### 主题与数据源

浅色（暖米色）与深色（石板灰）两套主题，用右上角的太阳/月亮按钮切换；选择会被保存，
图表也会原地换肤。

![Dark theme](docs/screenshots/17-dashboard-dark.png)

顶栏的 **Source ▾** 切换器列出所有已注册的 provider，并标注哪些有数据。首次启动时，
应用会自动选中第一个有数据的 provider。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) | 两个扩展接缝、Claude Code 适配器、如何接入新工具、MCP 探测、写入安全、网络绑定 |
| [docs/data-model.zh-CN.md](docs/data-model.zh-CN.md) | Run / Agent / Turn、准确性与去重说明、数据库 schema、成本估算 |
| [docs/api.zh-CN.md](docs/api.zh-CN.md) | 全部 HTTP 接口 |
| [docs/screenshots/](docs/screenshots/) | 全部 UI 截图及其脱敏方式（[中文说明](docs/screenshots/README.zh-CN.md)） |

## 项目结构

```
server.ts                  入口，Hono 应用，监听器启动，provider 扫描循环
src/
  paths.ts                 所有路径常量
  db.ts                    SQLite 初始化（bun:sqlite，WAL 模式）
  tokenizer.ts             js-tiktoken 封装
  pricing.ts               分模型价格表 + computeCost()
  thresholds.ts            可配置的告警阈值
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
        permissions.ts     规则解析 + 层合并 + 覆盖标记
        memory.ts          按项目的记忆库（MEMORY.md 索引 + 主题）
        effective.ts       合并后的设置层 + 层限制告警
  config/
    types.ts               ToolConfigAdapter 接口 + 中性配置结构
    index.ts               配置适配器注册表（与 provider 注册表平行）
    graph.ts               与 provider 无关的依赖图构建器
  transcripts/
    cache.ts               通用 SQLite 读写辅助函数（与 provider 无关）
    aggregate.ts           SQL 聚合查询（总量、序列、智能体、模型、项目）
    runs.ts                run id 解析、活跃度重算、运行列表/加载
    usageReport.ts         单次运行的用量拆解（分类桶、分模型成本、建议）
  audit/
    claudeMd.ts            CLAUDE.md 体积审计
    hooks.ts               settings.json hook 审计
    mcp.ts                 MCP 枚举 + 工具/schema 探测 + 诊断
    plugins.ts             插件列表审计
    skills.ts              skill 目录审计
    settings.ts            模型与权限审计
    index.ts               调度器，带 60 秒缓存
  watcher.ts               chokidar 监听器 → 把变更派发给所属 provider
  api/
    auditEndpoints.ts      审计报告、阈值、价格
    transcriptEndpoints.ts 用量数据：统计、时间序列、运行、智能体、树、用量报告
    configEndpoints.ts     /api/config/* —— Harness 标签页
    providersEndpoint.ts   GET /api/providers
static/
  index.html               侧边栏 SPA 外壳（12 个标签页 + 会话详情浮层）
  style.css                拟物柔和 UI 主题 —— 浅色 + 深色，CSS 变量
  config.css               Harness 标签页 + 运行 Usage 视图的样式
  app.js                   数据请求、ECharts、主题切换、会话树渲染、运行 Usage 视图
  config.js                Harness 标签页（claudemd/commands/skills/hooks/mcp/permissions/memory/workflow/configs）
  lib/
    echarts.min.js         Apache ECharts 5.5.1（离线，1007KB）
docs/                      架构、数据模型、API 参考、截图（中英双语）
data/                      SQLite 数据库存放处（已 git-ignore）
```

## 许可证

MIT —— 见 [LICENSE](LICENSE)。

---

## ☕ 支持这个项目

如果这个仪表盘帮你理解（或者控制住）了 LLM 的 token 开销 —— 哪怕只是让你不用再对着
JSONL 文件眯眼睛 —— 欢迎请我喝杯咖啡。这能让灯继续亮着，副业项目继续发布。

**[☕ Buy Me a Coffee](https://buymeacoffee.com/starbringer)**

不用有压力 —— 这个软件现在是、将来也一直会是免费的。
