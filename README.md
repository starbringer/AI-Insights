# Claude Usage Monitor

A local web app that reads Claude Code's JSONL transcript files and gives you a live dashboard of your token usage, costs, session history, and configuration health.

**No AI calls. No external services. All data stays on your machine.**

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (tested on 1.3.13)
- Windows (the browser-open command uses `cmd /c start`; other platforms work but won't auto-open)
- Claude Code installed with data in `~/.claude/projects/`

## Quick Start

```bash
# Install dependencies (first time only)
bun install

# Start the server (opens browser automatically)
bun run server.ts
```

Then open http://localhost:5757 if the browser doesn't open automatically.

## CLI Flags

| Flag | Description |
|------|-------------|
| `--port=N` | Listen on port N (default: 5757) |
| `--no-browser` | Don't auto-open the browser |
| `--static-only` | Skip file watcher; serve static files and existing DB only |

Environment variable `PORT` is also respected.

## Scripts

```bash
bun run start        # same as bun run server.ts
bun run dev          # hot-reload with --watch
bun run typecheck    # tsc --noEmit (zero-error check)
bun run build        # compile to dist/claude-usage.exe (Windows x64)
```

## What It Shows

### Dashboard
- 5 KPI cards: today, 7-day, 30-day totals (each with API-equiv cost), cache hit rate, active sessions
- Daily 30-day token trend chart (stacked: input / output / cache write / cache read)
- Token usage by model — stacked horizontal bar
- Top 10 projects by tokens — horizontal bar

### Audit
Data-driven findings about your Claude Code configuration:

| Finding | Metric |
|---------|--------|
| CLAUDE.md size | Word count + estimated tokens injected per session |
| Hook volume | Hook count × estimated fires × token cost |
| MCP servers | All servers from `claude mcp list` with scope (user/local/project/claude.ai) + schema tokens per turn + **estimated 30-day injection cost** (schema tokens × sessions in last 30d) |
| Cache efficiency | Hit rate over time (line chart + gauge) |
| Skills | Installed skills list with **SKILL.md token count** (per-invocation cost) |
| Plugins | Installed plugins list |
| Model mix | Token share per model |

Each finding has a configurable threshold (warn/error) you can adjust in the Settings tab.

### Sessions
Paginated table of all sessions with token counts, model, project path, and last-seen time. Supports search and project filter.

**Session Detail Flow** — Click **View** on any session to open a full-screen two-panel view (1:1 horizontal split). Press **← Sessions** or Escape to return.
- **Left panel (Map)**: directed flowchart, one conversation per group of 3 nodes: **User Prompt** → **Activities** → **Response**. Each conversation is wrapped in a labeled "ROUND N" card with a left-edge accent strip, visually grouping its nodes (including any sub-agents that branch to the right). Sub-agents loop back to the round's Final Reply with a dashed edge. All rounds are shown; the main flow column is horizontally centered and scrolls vertically.
- **Right panel (Detail)**: full detail for the selected node — prompt text, tool calls with inputs/results, or response text.

On mobile (≤ 640 px) the two panels are toggled via **Map / Detail** buttons in the top bar; tapping a node automatically switches to the Detail panel.

Color coding: user prompts (blue), activities/tool calls (teal), responses (gray), sub-agent branches (purple).

### Settings
- Edit warning/error thresholds for all audit metrics
- Edit per-model pricing (input/output/cache tokens per million)

## Data Source

The app reads `~/.claude/projects/**/*.jsonl`. These are Claude Code's local transcript files — they contain token usage data from the `usage` field of each API response message. No API keys are needed; all parsing is local.

Token estimation for prompt injection cost (CLAUDE.md, hooks, MCP schemas) uses `js-tiktoken` with `cl100k_base` encoding, which runs locally in WASM.

## Project Structure

```
server.ts                  Entry point, Hono app, file watcher startup
src/
  paths.ts                 All path constants
  db.ts                    SQLite setup (bun:sqlite, WAL mode)
  tokenizer.ts             js-tiktoken wrapper
  pricing.ts               Per-model cost table + computeCost()
  thresholds.ts            Configurable warning thresholds
  transcripts/
    parser.ts              Incremental JSONL parsing with byte-offset tracking
    cache.ts               SQLite read/write helpers
    titles.ts              Session title extraction
    aggregate.ts           SQL aggregation queries (totals, series, sessions)
  audit/
    claudeMd.ts            CLAUDE.md size audit
    hooks.ts               Settings.json hooks audit
    mcp.ts                 MCP server schema token audit (JSON-RPC probe)
    plugins.ts             Plugin list audit
    skills.ts              Skills directory audit
    settings.ts            Model + permissions audit
    index.ts               Orchestrator with 60s cache
  watcher.ts               chokidar watcher → incremental DB updates
  api/
    auditEndpoints.ts      GET/POST /api/audit, GET/PUT /api/thresholds, pricing
    transcriptEndpoints.ts /api/stats, /api/daily, /api/models, /api/sessions, /api/projects
static/
  index.html               4-tab SPA shell
  style.css                Dark theme, CSS variables
  app.js                   Vanilla JS: fetch, ECharts, session-detail flowchart
  lib/
    echarts.min.js         Apache ECharts 5.5.1 (offline, 1007KB)
data/                      SQLite DB lives here (git-ignored)
```

## Database

SQLite at `data/cache.db` (WAL mode). Three tables:

- **`files`** — tracks each JSONL file path + byte offset for incremental parsing
- **`turns`** — one row per API call: session_id, model, token counts, timestamp
- **`sessions`** — one row per session: title, cwd, subagent flag, first/last seen

The DB is rebuilt automatically from JSONL files on each startup. You can delete `data/cache.db` at any time to force a full re-parse.

## Subscription Usage

The app only tracks **API token usage** recorded in JSONL transcripts. It does not show Pro/Max subscription seat usage — Anthropic provides no programmatic API for that. Check https://claude.ai/settings/usage directly.

## Building a Standalone Executable

```bash
bun run build
# produces dist/claude-usage.exe (Windows x64, ~60MB, no Bun install needed)
```

The compiled binary embeds the Bun runtime. Static files in `static/` must be distributed alongside it.

## License

MIT — see [LICENSE](LICENSE).
