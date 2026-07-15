# LLM Usage Monitor

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-yellow)](https://buymeacoffee.com/starbringer)

A local web app that turns raw LLM usage data into a live dashboard — token counts, costs, session history, and configuration health.

Today it parses **Claude Code's JSONL transcripts**. The architecture is intentionally provider-agnostic so additional sources (Gemini, ChatGPT exports, local Ollama, etc.) can be plugged in over time.

**No AI calls. No external services. All data stays on your machine.**

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (tested on 1.3.13)
- Windows (the browser-open command uses `cmd /c start`; other platforms work but won't auto-open)
- At least one supported data source:
  - **Claude Code** with data in `~/.claude/projects/` *(currently the only built-in source)*

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
bun run build        # compile to dist/llm-usage.exe (Windows x64)
```

## Interface

The UI is a **neomorphic / soft-UI** design — tactile minimal cards built from soft dual shadows, a warm amber accent, and a left sidebar for navigation. A **light** (warm cream) and **dark** (slate) theme are both included; toggle them with the **Theme** control at the bottom of the sidebar. The choice is persisted to `localStorage` and charts re-theme in place.

## Concepts: Run / Agent / Turn

The app organizes recorded activity into three nested levels:

- **Run** — one logical execution (one AI session). May contain one or many agents. For a plain chat (no sub-agents) a run holds exactly one agent. For something like an orchestrator that spawns multiple Task sub-agents, the run holds the parent plus all descendants linked through the provider's native parent/child markers.
- **Agent** — one conversation context. Maps to a single transcript file (one `.jsonl` for Claude Code). An agent has a model, a cwd, a title, and a list of turns.
- **Turn** — one **API call** (one LLM request/response). Claude Code writes one JSONL line per content block of a response, each repeating the same usage numbers — turns are deduplicated by the response's `message.id`, so token totals count each API call exactly once. Failed calls echoed with model `<synthetic>` are excluded from counts and the model list (they surface in the session tree as error nodes instead).

Sub-agents are detected from the provider's own data — for Claude Code that's the `<parent>/subagents/agent-*.jsonl` directory convention. No heuristics or content sniffing. If a provider's framework doesn't record parent/child links between separate transcript files, each transcript becomes a one-agent run; this is correct behavior, not a limitation.

### Accuracy notes

- **Token dedupe:** without `message.id` dedupe, real transcripts over-count output tokens ~2.4× (each multi-block response is written as several lines). All totals, charts, and cost estimates use the deduped numbers.
- **Day boundaries:** "Today" / daily buckets use your local calendar day, not UTC.
- **Titles:** a run is titled by the transcript's `ai-title` record (Claude Code's own AI-generated session title) when present; otherwise by the first real user prompt with IDE/framework wrapper tags stripped.
- **Cache write TTL:** the 5m/1h split comes from `usage.cache_creation`; legacy records with only a total are attributed to the 5m bucket (the default TTL) so cost is not overstated.

## What It Shows

### Dashboard
- 5 KPI cards: today, 7-day, 30-day totals (each with API-equiv cost), cache hit rate, **active runs**
- Daily 30-day token trend chart (stacked: input / output / cache write / cache read)
- Token usage by model — stacked horizontal bar
- Top projects by tokens — horizontal bar (with run + agent counts)
- **Top 10 runs by tokens** — stacked horizontal bar; click a bar to open that run's detail page

### Audit
Data-driven findings about your Claude Code configuration:

| Finding | Metric |
|---------|--------|
| CLAUDE.md size | Global **and per-project** CLAUDE.md files (projects discovered from your transcripts, case-deduped), word/token counts, injected tokens per day = global size × agents active that day |
| Hook volume | Hook entries from settings.json/.claude.json (with matchers) × **recorded** fires from the transcript event stream: real prompt counts for UserPromptSubmit, real Stop-hook fires, Pre/PostToolUse counted against the entry's matcher regex over actual tool calls |
| MCP servers | All servers from `claude mcp list` with scope (user/local/project/claude.ai) + schema tokens per turn (live JSON-RPC probe of stdio servers) + estimated 30-day injection cost (schema tokens × agents in last 30d) |
| Cache efficiency | Hit rate over time (line chart + gauge) |
| Skills | Installed skills list with SKILL.md token count (per-invocation cost) |
| Settings | Default model + effort level, permission allow/deny rule counts, auto-approve warning |
| Plugins | Installed plugins list |
| Model mix | Token share per model (last 30 days) |

Each finding has a configurable threshold (warn/error) you can adjust in the Settings tab.

### Runs
Paginated table of all runs with title, project, **agent count** (× N badge when > 1), turn count, token totals, and last-active time. Supports search and project filter.

**Run Detail — Session Trees** — Click **View** on any run (or open `#run=<run_id>` directly) to open a full-screen three-panel layout. Press **← Runs** or Escape to return.

The middle canvas renders the whole session as **one tree per agent, all stacked in the same scrollable view**: the main agent's tree first, then each sub-agent's own tree below it. Within a tree:

- The **spine** (top level) is the chronological flow of the conversation: user prompts → LLM calls → hook fires → compactions → errors, connected by a vertical thread.
- Each **LLM call** node shows the model, output/cache-read tokens, and expands into its children: interleaved **thinking**, **text output**, and every **tool call** in order — plain tools ⚙, **MCP calls** ⇄, **sub-agent spawns** ◈ (with a `tree ↓` jump link to that sub-agent's tree), and **skill invocations** ❖ with the injected skill content nested beneath.
- Tool nodes carry their **result inline** (✓/✗ + preview); the full input/result opens in the right panel.
- **Framework events** are first-class nodes: `⚡` hook fires (command + duration, flags blocked continuations), `✕` API errors and rate-limit retries, `▣` context compactions (pre → post token counts), `⤷` model refusal fallbacks (original → fallback model), `✚` injected context (todo reminders, IDE state, deferred tool loads…).
- **Branches** in the transcript DAG (prompt edits, retries, rewinds) render as collapsed `⎇ Abandoned branch` sub-trees — the mainline follows the path the session actually continued on.

Panels: **left** — agents in the session (click to scroll to that agent's tree); **right** — full detail for the selected node (complete prompt/output text, tool input & result, usage chips, hook/error metadata). The top bar shows session totals: prompts, LLM calls, tools, MCP, sub-agents, hooks, errors, compactions, branches.

On mobile (≤ 900 px) the detail panel hides and toggles in via a top-bar tab; on ≤ 640 px the agents panel also toggles.

### Settings
- Edit warning/error thresholds for all audit metrics
- Edit per-model pricing (input/output/cache tokens per million)

## Data Sources

The top bar has a **Source ▾** switcher that lists every registered provider. The active selection is persisted to `localStorage`. On first launch the app picks the first provider that has data; if none do, the app still loads and shows a "No usage data detected" banner with the expected data location.

Providers are self-contained adapters under [`src/providers/<id>/`](src/providers/). The shared interface is defined in [`src/providers/types.ts`](src/providers/types.ts):

```ts
export interface Provider {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData(): boolean;
  watchGlobs(): string[];                   // patterns the watcher should mind
  fileMatches(path: string): boolean;       // does this path belong to this provider?
  scanAll(db): void;                        // startup full scan
  ingestFile(db, path): void;               // incremental update for one file + refresh derived roll-ups
  loadAgentDetail(agentId): NormalizedTurn[];  // detail page rows
}
```

The registry in [`src/providers/index.ts`](src/providers/index.ts) lists every provider, and `providerForPath(path)` dispatches changed files to the right one. `GET /api/providers` exposes the list to the UI together with a `hasData` flag (computed at request time).

### Claude Code (current)

Lives in [`src/providers/claude-code/`](src/providers/claude-code/). The adapter reads `~/.claude/projects/**/*.jsonl` — Claude Code's local transcript files — and emits normalized turns plus a full session tree for the detail page. The Claude Code-specific conventions it recognizes:
- **Multi-line responses**: one API response spans several `assistant` lines (one per content block) sharing `message.id` — grouped into a single turn
- **`<synthetic>` error echoes** (`isApiErrorMessage`) — excluded from usage, shown as error nodes in the tree
- **`system` lines**: `stop_hook_summary` (hook fires), `api_error` (retries), `compact_boundary` (context compaction, re-linked through `logicalParentUuid`), `model_refusal_fallback`, `turn_duration`
- **`attachment` lines** (todo reminders, deferred tool loads, IDE state, …) — shown as injected-context nodes
- **`ai-title` lines** — preferred source for run titles
- **uuid/parentUuid branching** (prompt edits, retries) — mainline resolved as the path with the latest descendant; side paths become branch sub-trees
- **Sub-agent transcripts** at `<parent-agent-id>/subagents/agent-*.jsonl` (Task-spawned children) and in-file sidechains (`isSidechain`)
- The `sourceToolUseID` field linking injected content (skill bodies) back to the tool call that produced it

No API keys are needed; all parsing is local.

### Adding a new provider (Gemini / ChatGPT / Ollama / …)

1. Create `src/providers/<id>/index.ts` exporting an object that implements the `Provider` interface from [`src/providers/types.ts`](src/providers/types.ts).
2. Inside that folder, write a parser that walks `dataDir` and upserts rows via the helpers in [`src/transcripts/cache.ts`](src/transcripts/cache.ts), and a detail loader that returns `NormalizedTurn[]`.
3. Append your provider object to the `PROVIDERS` array in [`src/providers/index.ts`](src/providers/index.ts).

The watcher, aggregations, audit, pricing, and UI are all provider-agnostic — they only operate on rows in the SQLite tables and `NormalizedTurn` objects. Pricing keys off the model name, so as long as your turns include a recognizable model string, costs work out of the box.

Token estimation for prompt injection cost (CLAUDE.md, hooks, MCP schemas) uses `js-tiktoken` with `cl100k_base` encoding, which runs locally in WASM.

## Project Structure

```
server.ts                  Entry point, Hono app, watcher startup, provider scan loop
src/
  paths.ts                 All path constants
  db.ts                    SQLite setup (bun:sqlite, WAL mode)
  tokenizer.ts             js-tiktoken wrapper
  pricing.ts               Per-model cost table + computeCost()
  thresholds.ts            Configurable warning thresholds
  providers/
    types.ts               Provider interface + NormalizedTurn shape
    index.ts               Provider registry, providerForPath / providerById lookups
    claude-code/           Self-contained Claude Code adapter
      index.ts             Exports the claudeCodeProvider object
      parser.ts            Incremental JSONL parsing, message.id dedupe, sub-agent meta.json
      agentDetail.ts       Reads a JSONL and emits NormalizedTurn[] (no length truncation)
      agentTree.ts         Folds the transcript DAG into render-ready session trees
      titles.ts            Agent title extraction (wrapper-tag stripping)
  transcripts/
    cache.ts               Generic SQLite read/write helpers (provider-agnostic)
    aggregate.ts           SQL aggregation queries (totals, series, agents, models, projects)
    runs.ts                Derived roll-up: run-id resolution (parent-chain walk), agent activity recompute (turn count + last-seen), refreshRuns; listRuns, loadRun, getTopRuns
  audit/
    claudeMd.ts            CLAUDE.md size audit
    hooks.ts               Settings.json hooks audit
    mcp.ts                 MCP server schema token audit (JSON-RPC probe)
    plugins.ts             Plugin list audit
    skills.ts              Skills directory audit
    settings.ts            Model + permissions audit
    index.ts               Orchestrator with 60s cache
  watcher.ts               chokidar watcher → dispatches changes to the owning provider
  api/
    auditEndpoints.ts      GET/POST /api/audit, GET/PUT /api/thresholds, pricing
    transcriptEndpoints.ts /api/stats, /api/timeseries, /api/models, /api/projects, /api/runs, /api/run/:id, /api/agents, /api/agent/:id (flat turns), /api/agent/:id/tree (session tree), /api/top-runs, /api/top-turns
    providersEndpoint.ts   GET /api/providers
static/
  index.html               Sidebar SPA shell (4 tabs + session-detail overlay)
  style.css                Neomorphic soft-UI theme — light + dark, CSS variables
  app.js                   Vanilla JS: fetch, ECharts, theme toggle, session-tree renderer
  lib/
    echarts.min.js         Apache ECharts 5.5.1 (offline, 1007KB)
data/                      SQLite DB lives here (git-ignored)
```

## Database

SQLite at `data/cache.db` (WAL mode). Five tables, all carrying a `provider` column for future multi-source support:

- **`files`** — tracks each transcript file path + byte offset for incremental parsing.
- **`runs`** — derived roll-up, one row per logical run: title, cwd, agent count, turn count, first/last seen. Rebuilt from `agents`/`turns` after every full scan **and** after every incremental ingest (debounced), so the Runs page stays live without a restart.
- **`agents`** — one row per agent (one transcript file). Carries `run_id`, `parent_agent_id`, `parent_turn_index` (for ordering siblings), `agent_type`, `description` (from sub-agent `meta.json` when present), title, cwd, last seen, turn count.
- **`turns`** — one row per API call, **unique on (agent_id, message_id)**: agent_id, run_id, message_id, request_id, model, token counts, timestamp. The unique index is what deduplicates Claude Code's one-line-per-content-block format. Source of truth for token totals, turn counts, and last-seen times — all recomputed from here, never trusted from a maintained counter (incremental parsing of timestamp-less trailing records like `ai-title`/`mode`/`summary` would otherwise zero out turn counts or null out `last_seen_at`).
- **`events`** — lightweight event stream extracted during parsing, idempotent on (agent_id, source uuid): real user prompts, tool calls (with tool name), hook fires, API errors, compactions, model fallbacks. Powers the audit page's recorded (not estimated) counts.

The schema is versioned (`PRAGMA user_version`). When the app starts and finds a different version it drops and recreates everything, then re-parses every transcript. You can also delete `data/cache.db` at any time to force a full rebuild.

## Subscription Usage

The app only tracks **API token usage** recorded in JSONL transcripts. It does not show Pro/Max subscription seat usage — Anthropic provides no programmatic API for that. Check https://claude.ai/settings/usage directly.

## Building a Standalone Executable

```bash
bun run build
# produces dist/llm-usage.exe (Windows x64, ~60MB, no Bun install needed)
```

The compiled binary embeds the Bun runtime. Static files in `static/` must be distributed alongside it.

## License

MIT — see [LICENSE](LICENSE).

---

## ☕ Support This Project

If this dashboard has helped you understand (or rein in) your LLM token spend — or just saved you from squinting at JSONL files — consider buying me a coffee. It helps keep the lights on and the side projects shipping.

**[☕ Buy Me a Coffee](https://buymeacoffee.com/starbringer)**

No pressure — the software is and always will be free.
