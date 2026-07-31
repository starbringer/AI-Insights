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

Both the MCP server and the skills are set up automatically at startup — [details](docs/mcp.md).

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

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash          # macOS / Linux
powershell -c "irm bun.sh/install.ps1 | iex"      # Windows

# 2. Get the code and run it
git clone https://github.com/starbringer/ai-insights.git
cd ai-insights
bun install
bun run start
```

That's it. What happens next:

- **The browser opens** on **http://localhost:5757** (Windows, macOS, Linux with `xdg-open`) — otherwise open it yourself.
- **First start scans** every transcript under `~/.claude/projects/`, builds `data/cache.db`, then watches those files. New activity shows up within a couple of seconds, no restart. A large history takes a few seconds; the page is usable after the first pass.
- **No data yet?** The app still loads and tells you where it expected to find it.
- **Your AI gets access too** — the same command serves the MCP endpoint at `http://127.0.0.1:5757/mcp`, installs the `ai-usage-review` and `ai-change-impact` skills into every detected AI tool, and registers the server with each. Restart your AI tool once, then run `/ai-usage-review`.

No extra command, no second process, no Docker. Every step is idempotent and prints
one line the first time only. Opt out with `--no-provision`. Full reference:
**[docs/mcp.md](docs/mcp.md)**.

### Command-line options

```bash
bun run server.ts --port=8080 --no-browser
```

| Flag | Description |
|------|-------------|
| `--port=N` | Listen on port N (default: `5757`) |
| `--host=H` | Bind address (default: `127.0.0.1`) — the config API can edit files, so it stays loopback-only unless you opt in to `0.0.0.0`. [Why](docs/architecture.md#network-binding) |
| `--no-browser` | Don't auto-open the browser |
| `--static-only` | Skip the file watcher (and the browser) — the startup scan still runs, but later changes need a restart |
| `--no-provision` | Don't install the skill or register the MCP server with your AI tools. `/mcp` is still served |

The environment variables `PORT` and `HOST` work too.

### Scripts

| Script | Does |
|---|---|
| `bun run start` | Server + MCP endpoint (same as `bun run server.ts`) |
| `bun run dev` | Hot-reload with `--watch` |
| `bun run mcp` | MCP server over stdio, for clients that can't use HTTP |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit test suite |
| `bun run build` | Standalone binary for the current platform |
| `bun run build:mcp` | Standalone binary of the stdio MCP server |

### Rebuilding the cache

The database is a cache — the JSONL transcripts are the only source of truth.
Delete `data/cache.db` and restart to force a clean re-parse. The app does this
itself whenever an update changes the schema version.

### Data retention

The cache keeps a rolling window — **30 days by default**, 1–365 in **Settings →
Data retention** (`data/retention.json`). Older records are deleted at startup
and hourly.

The window bounds everything: chart ranges, recorded counts, MCP tool ranges.
Narrowing deletes the excess at once; widening re-scans transcripts to restore
what they still hold.

### Standalone executable

```bash
bun run build   # → dist/ai-insights (.exe on Windows), ~60MB, no Bun install needed
```

- Ship `static/` and `assets/` alongside the binary — all three plus the `data/` cache resolve next to the executable, so it launches from any working directory.
- Without `assets/`, everything works except installing the bundled skill.
- Cross-compile with a target: `bun build --compile --target=bun-<windows|darwin|linux>-x64 server.ts --outfile dist/ai-insights` (`bun-darwin-arm64` for Apple Silicon).

---

## Features

*Screenshots are captured from real usage with every project name, path,
conversation and configuration name replaced by consistent stand-ins — see
[docs/screenshots/](docs/screenshots/).*

### MCP server and skills

Everything the dashboard shows is also a **read-only MCP server on the app's own
port** — 33 tools covering usage, change impact and harness configuration. Two
bundled skills consume it: **`ai-usage-review`** turns the numbers into ranked,
evidence-backed fixes, and **`ai-change-impact`** measures what a change actually
saved.

**Every tool is read-only by design.** The skills propose; your assistant applies
what you accept through its normal, permission-gated edit tools. Setup, every
tool, both skills, other clients (including stdio) and what is deliberately not
exposed: **[docs/mcp.md](docs/mcp.md)**. How to invoke the skills, with worked
examples: **[docs/skills.md](docs/skills.md)**.

### Dashboard

KPI cards and a token trend split by input, output and cache, then breakdowns by
model, project, MCP server and skill. Every chart has its own range switcher.

![Dashboard charts](docs/screenshots/02-dashboard-charts.png)

### Runs

Every recorded session with project, agent count, turns and token totals —
searchable and filterable. Each row carries the run's id, which is what you hand
to `ai-change-impact` to compare two sessions.

![Runs](docs/screenshots/03-runs.png)

A **run** is one logical session → one or more **agents** (one transcript each) →
**turns** (one API call each). [More on the model](docs/data-model.md#run--agent--turn).

### Run detail

A three-panel replay: agents on the left, the session tree in the middle, full
node detail on the right. Prompts, LLM calls, tool and MCP calls, hook fires,
sub-agent spawns, compactions and errors, in order.

![Run detail — session tree](docs/screenshots/04-run-detail-tree.png)

The second tab is a cost breakdown for that one run — spend curve, per-model
table, a base / MCP / skills / sub-agents donut, and tuning advice computed from
this run's real numbers.

![Run detail — usage](docs/screenshots/05-run-detail-usage.png)

### Harness

Inspect — and where safe, edit — the active tool's configuration. Each tab
appears only if the active provider supports that capability.

**CLAUDE.md** — every instruction file the tool injects, with token counts, an
inline editor, and a timeline of injected tokens per day.

![CLAUDE.md](docs/screenshots/06-claudemd.png)

**Commands** — slash commands from user, project and plugin sources, with
override detection so you can see which definition wins.

![Commands](docs/screenshots/07-commands.png)

**Skills** — token cost, recorded invocations, a trigger analyzer, and a
**Related components** graph of the hooks, servers and commands each skill is
wired to.

![Skills](docs/screenshots/08-skills.png)

**Hooks** — every hook across every settings layer with its matcher and
**recorded fire count**, from the event stream rather than estimated.

![Hooks](docs/screenshots/09-hooks.png)

Actions that run a script file are resolved on disk — click one to read, edit and
save it.

![Hook script editor](docs/screenshots/10-hooks-script.png)

**MCP** — scope, transport, probe status, injection estimate, and expandable
tools with their JSON schemas. Servers are read from config files, never
executed — [why](docs/architecture.md#mcp-why-config-files-not-the-cli).

![MCP](docs/screenshots/11-mcp.png)

**Permissions** — `allow` / `deny` / `ask` rules across layers, merged into the
effective set, with shadowed rules struck through.

![Permissions](docs/screenshots/12-permissions.png)

**Memory** — the MEMORY.md index and every topic file, with an **orphan** badge
for files the index never links.

![Memory](docs/screenshots/13-memory.png)

**Configs** — a read-only merged view of the settings layers: each key's winning
value, what it overrides, and warnings for keys set in a layer the tool never
reads.

![Effective Configs](docs/screenshots/15-configs.png)

### Settings

Warning thresholds behind the Harness badges, [data retention](#data-retention),
and the per-model reference pricing that drives every cost number.

![Settings](docs/screenshots/16-settings.png)

### Themes and data sources

Light and dark themes that persist and re-theme charts in place, and a
**Source ▾** switcher listing every registered provider and which have data.

![Dark theme](docs/screenshots/17-dashboard-dark.png)

Every screen's full control reference: **[docs/ui.md](docs/ui.md)**.

---

## Documentation

| Document | Contents |
|---|---|
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
