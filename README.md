# AI Insights

**English** | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-yellow)](https://buymeacoffee.com/starbringer)

<p align="center">
  <img src="assets/social-preview.png" alt="AI Insights — understand and improve how you use AI coding tools" width="840">
</p>

A local web app that turns raw AI coding-tool usage into a live dashboard — token
counts, costs, session history, configuration health.

- **Dashboard** — where your tokens and money actually go
- **Built-in MCP server** — 33 read-only tools, so your AI assistant reads the same data
- **`ai-usage-review` skill** — turns that data into ranked, evidence-backed fixes
- **`ai-change-impact` skill** — measures what an improvement actually saved, in dollars
- **Provider-agnostic** — today it parses Claude Code's JSONL transcripts; other sources can plug in later

**Privacy**

| | |
|---|---|
| **The app** | Never calls an AI model. No API keys, no external services, no telemetry — your transcripts never leave your machine. Parsing, token counting and every check are deterministic local computation |
| **The skills** | The one AI part. They run inside *your* AI assistant and spend *its* tokens; the app only serves local data to them over MCP |

![Dashboard](docs/screenshots/01-dashboard.png)

---

## Requirements

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) ≥ 1.1 (tested on 1.3.13) |
| OS | Windows, macOS or Linux — the server behaves identically; browser auto-open picks `open` / `cmd /c start` / `xdg-open` and is skipped silently if none exists |
| Data | **Claude Code** transcripts in `~/.claude/projects/` *(currently the only built-in source)* |

## Setup

**1. Install Bun** — macOS / Linux:

```bash
curl -fsSL https://bun.sh/install | bash
```

Windows:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**2. Get the code:**

```bash
git clone https://github.com/starbringer/ai-insights.git
```

```bash
cd ai-insights
```

**3. Install dependencies:**

```bash
bun install
```

**4. Run it:**

```bash
bun run start
```

The browser opens on **http://localhost:5757** — otherwise open it yourself.

That one command installs four things, idempotently:

- **The app** — dashboard, file watcher and HTTP API
- **The MCP server** — served at `http://127.0.0.1:5757/mcp`, registered with every detected AI tool
- **The `ai-usage-review` skill** — installed into every detected AI tool
- **The `ai-change-impact` skill** — installed into every detected AI tool

Restart your AI tool once so it picks them up, then run `/ai-usage-review`.
Opt out with `--no-provision`.

---

## Features

*Screenshots are captured from real usage with every project name, path,
conversation and configuration name replaced by consistent stand-ins — see
[docs/screenshots/](docs/screenshots/).*

### MCP server

Everything the dashboard shows, exposed to your AI assistant as 33 **read-only**
tools on the app's own port — usage, change impact and harness configuration.
Nothing writes: the assistant applies what you accept through its own
permission-gated edit tools.

Every tool, other clients (including stdio) and what is deliberately not exposed:
**[docs/mcp.md](docs/mcp.md)**.

### Skills

Two bundled skills consume those tools:

- **`ai-usage-review`** — turns the numbers into ranked, evidence-backed fixes
- **`ai-change-impact`** — measures what a change actually saved, in dollars

How to invoke them, with worked examples: **[docs/skills.md](docs/skills.md)**.

### Dashboard

KPI cards, a token trend split by input, output and cache, then breakdowns by
model, project, MCP server and skill.

![Dashboard charts](docs/screenshots/02-dashboard-charts.png)

### Runs

Every recorded session, searchable and filterable. Each row's run id is what you
hand to `ai-change-impact` to compare two sessions.

![Runs](docs/screenshots/03-runs.png)

A **run** is one logical session → one or more **agents** (one transcript each) →
**turns** (one API call each). [More on the model](docs/data-model.md#run--agent--turn).

### Run detail

A three-panel replay of one session: prompts, LLM calls, tool and MCP calls, hook
fires, sub-agent spawns, compactions and errors, in order.

![Run detail — session tree](docs/screenshots/04-run-detail-tree.png)

The second tab breaks that run's cost down, and the advice is computed from this
run's real numbers rather than generic rules.

![Run detail — usage](docs/screenshots/05-run-detail-usage.png)

### Harness

Inspect — and where safe, edit — the active tool's configuration. Each tab
appears only if the active provider supports that capability.

**CLAUDE.md** — every instruction file the tool injects, with an inline editor.

![CLAUDE.md](docs/screenshots/06-claudemd.png)

**Commands** — slash commands from user, project and plugin sources, with
override detection so you can see which definition wins.

![Commands](docs/screenshots/07-commands.png)

**Skills** — cost, recorded invocations, a trigger analyzer, and the hooks,
servers and commands each skill is wired to.

![Skills](docs/screenshots/08-skills.png)

**Hooks** — every hook across every settings layer. The fire count is recorded
from the event stream, not estimated.

![Hooks](docs/screenshots/09-hooks.png)

Actions that run a script file are resolved on disk — click one to read, edit and
save it.

![Hook script editor](docs/screenshots/10-hooks-script.png)

**MCP** — scope, transport, probe status, injection estimate, and expandable tool
schemas. Servers are read from config files, never executed —
[why](docs/architecture.md#mcp-why-config-files-not-the-cli).

![MCP](docs/screenshots/11-mcp.png)

**Permissions** — rules across layers merged into the effective set, with
shadowed rules struck through.

![Permissions](docs/screenshots/12-permissions.png)

**Memory** — the MEMORY.md index and every topic file, with an **orphan** badge
for files the index never links.

![Memory](docs/screenshots/13-memory.png)

**Configs** — the merged settings layers, with warnings for keys set in a layer
the tool never reads.

![Effective Configs](docs/screenshots/15-configs.png)

### Settings

Warning thresholds behind the Harness badges, data retention, and the per-model
reference pricing that drives every cost number.

![Settings](docs/screenshots/16-settings.png)

### Themes and data sources

Themes persist and re-theme charts in place. **Source ▾** lists every registered
provider and which have data.

![Dark theme](docs/screenshots/17-dashboard-dark.png)

Every screen's full control reference: **[docs/ui.md](docs/ui.md)**.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/cli.md](docs/cli.md) | Command-line options, environment variables, scripts, standalone build |
| [docs/storage.md](docs/storage.md) | The cache, rebuilding it, and the data-retention window |
| [docs/ui.md](docs/ui.md) | Every screen and the controls it carries, with screenshots |
| [docs/skills.md](docs/skills.md) | Both skills: how to invoke them, worked examples, the review→apply→measure loop |
| [docs/mcp.md](docs/mcp.md) | The MCP server: setup, every tool, other clients, what is not exposed, security |
| [docs/architecture.md](docs/architecture.md) | The two provider seams, the Claude Code adapter, how to add a new tool, the MCP server, provisioning, MCP probing, write safety, network binding |
| [docs/data-model.md](docs/data-model.md) | Run / agent / turn, accuracy and dedupe notes, database schema, cost estimation |
| [docs/api.md](docs/api.md) | Every HTTP endpoint, and the `?provider=` selector they all accept |
| [docs/screenshots/](docs/screenshots/) | All UI screenshots and how they were anonymized |

## Project Structure

```
server.ts                  Entry point, Hono app, watcher startup, provider scan loop, provisioning
mcp-stdio.ts               MCP server over stdio, for clients that can't use HTTP
src/
  paths.ts                 All path constants
  provision.ts             Provider-agnostic startup provisioning (skills + MCP registration)
  db.ts                    SQLite setup (bun:sqlite, WAL mode)
  tokenizer.ts             js-tiktoken wrapper
  pricing.ts               Per-model cost table + computeCost()
  thresholds.ts            Configurable warning thresholds
  retention.ts             Data-retention window: setting, cutoff, pruning, hourly sweep
  providers/
    types.ts               Provider interface + NormalizedTurn shape
    index.ts               Provider registry, providerForPath / providerById lookups
    claude-code/           Self-contained Claude Code adapter
      index.ts             Exports the claudeCodeProvider object
      parser.ts            Incremental JSONL parsing, message.id dedupe, bucket classification
      agentDetail.ts       Reads a JSONL and emits NormalizedTurn[]
      agentTree.ts         Folds the transcript DAG into render-ready session trees
      titles.ts            Agent title extraction (wrapper-tag stripping)
      config/              Claude Code's ToolConfigAdapter (Harness tabs)
        index.ts           Assembles the adapter + capability flags
        shared.ts          Project discovery, plugin enumeration, override ranking
        instructions.ts    CLAUDE.md enumeration + whitelisted read/write + injection series
        commands.ts        Three-source command scan, namespacing, create/edit/delete
        skills.ts          Three-source skill scan, trigger analysis, recorded usage
        hooks.ts           Hooks across settings layers, script resolution, fire counts
        mcp.ts             MCP enumeration from config files + tool/schema probes + diagnostics
        permissions.ts     Rule parsing + layer merge + override marking
        memory.ts          Per-project memory stores (MEMORY.md index + topics)
        effective.ts       Merged settings layers with layer-restriction warnings
        provision.ts       Skill install + `claude mcp add` registration
  config/
    types.ts               ToolConfigAdapter interface + neutral config shapes
    index.ts               Config-adapter registry (parallel to the provider registry)
    graph.ts               Provider-agnostic dependency graph builder (feeds "Related components")
    snapshots.ts           Harness fingerprint log: capture, diff, change timeline
  transcripts/
    cache.ts               Generic SQLite read/write helpers (provider-agnostic)
    aggregate.ts           SQL aggregation queries (totals, series, agents, models, projects)
    runs.ts                Run-id resolution, activity recompute, run listing/loading
    usageReport.ts         Per-run usage breakdown (buckets, per-model costs, advice)
    runKey.ts              Derived provider-neutral run ids + prefix resolution
    window.ts              End-bounded time windows + the retention guard
    compare.ts             Run-vs-run and period-vs-period comparison, driver attribution
  watcher.ts               chokidar watcher → dispatches changes to the owning provider
  mcp/
    tools.ts               MCP tool registry — read-only, provider-aware
    protocol.ts            Transport-independent JSON-RPC / MCP dispatch
  api/
    providerParam.ts       Shared ?provider= resolution (HTTP + MCP)
    settingsEndpoints.ts   Thresholds + retention (read/write) + pricing (read)
    transcriptEndpoints.ts Usage data: stats, timeseries, runs, agents, trees, usage reports
    configEndpoints.ts     /api/config/* — the Harness tabs
    providersEndpoint.ts   GET /api/providers
    mcpEndpoint.ts         POST /mcp (streamable HTTP) + GET /api/mcp-server
static/
  index.html               Sidebar SPA shell (11 tabs + session-detail overlay)
  favicon.svg              Browser-tab icon, flattened for legibility at 16px
  style.css                Neomorphic soft-UI theme — light + dark, CSS variables
  config.css               Styles for the Harness tabs + run Usage view
  app.js                   Fetch, ECharts, theme toggle, session-tree renderer, run Usage view
  config.js                Harness tabs (claudemd/commands/skills/hooks/mcp/permissions/memory/configs) + the shared dependency-cluster renderer
  lib/
    echarts.min.js         Apache ECharts 5.5.1 (offline, 1007KB)
assets/
  icon.svg                 Master app icon, 512×512 (static/favicon.svg is the 32px cut)
  social-preview.png       GitHub social preview, 1280×640 — rendered from the .html beside it
  skills/
    ai-usage-review/       Usage audit skill, installed into every detected AI tool
    ai-change-impact/      Before/after measurement skill, installed the same way
      SKILL.md             Workflow: scope → gather → diagnose → report → apply
      references/          The 11 checks, and how to author skills/hooks/subagents
docs/                      Architecture, data model, API + MCP reference, screenshots
data/                      SQLite DB lives here (git-ignored)
```

## License

MIT — see [LICENSE](LICENSE).

---

## ☕ Support This Project

If this dashboard has helped you understand (or rein in) your LLM token spend,
consider buying me a coffee.

**[☕ Buy Me a Coffee](https://buymeacoffee.com/starbringer)**

No pressure — the software is and always will be free.
