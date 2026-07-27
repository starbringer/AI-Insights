# HTTP API

**English** | [简体中文](api.zh-CN.md)

Everything the UI does goes through these routes, so they double as a local API for
scripts. The server is loopback-only by default (see
[architecture › network binding](architecture.md#network-binding)).

All responses are JSON. Errors return `{ "error": "…" }` with a 4xx/5xx status;
config routes answer `501` when the active provider's adapter doesn't implement
that capability.

## Providers

| Route | Description |
|---|---|
| `GET /api/providers` | Registered providers with a live `hasData` flag |

Every `/api/config/*` route accepts `?provider=<id>` to target a specific tool
(defaults to the active/first provider).

## Usage data

Routes marked *ranged* accept `?range=1h\|24h\|7d\|30d`. Bucket size adapts:
5-minute slices for `1h`, hourly for `24h`, daily otherwise.

| Route | Description |
|---|---|
| `GET /api/stats` | KPI totals: today, 7d, 30d, cache hit rate, active runs |
| `GET /api/timeseries` | *ranged* — token trend (input / output / cache write / cache read) |
| `GET /api/models` | *ranged* — totals per model |
| `GET /api/projects` | *ranged* — totals per project cwd, with run and agent counts |
| `GET /api/runs` | Paginated run list; `?limit=`, `?offset=`, `?search=`, `?project=` |
| `GET /api/run/:runId` | One run with its agents |
| `GET /api/run/:runId/usage` | Per-run cost breakdown: buckets, per-model rollup, cumulative series, tuning advice |
| `GET /api/top-runs` | *ranged* — top runs by tokens |
| `GET /api/top-turns` | *ranged* — most expensive individual API calls |
| `GET /api/mcp-usage` | *ranged* — estimated tokens per MCP server, with per-tool breakdown |
| `GET /api/skill-usage` | *ranged* — estimated tokens per skill invocation |
| `GET /api/agents` | Agent list |
| `GET /api/agent/:agentId` | Flat normalized turns for one agent |
| `GET /api/agent/:agentId/tree` | Render-ready session tree for the run detail page |

## Configuration (Harness)

| Route | Description |
|---|---|
| `GET /api/config/capabilities` | What the active adapter supports — drives which tabs appear |
| `GET /api/config/projects` | Project directories discovered from transcripts (for the scope selectors) |
| `GET /api/config/instructions` | Instruction files + injected-tokens series |
| `GET /api/config/instructions/file?path=` | Raw file content |
| `PUT /api/config/instructions/file` | Write one enumerated instruction file |
| `GET /api/config/commands` | Slash commands from all sources, with override marking |
| `PUT /api/config/commands/file` | Write one editable command file |
| `POST /api/config/commands` | Create a command |
| `DELETE /api/config/commands` | Delete an editable command |
| `GET /api/config/skills` | Skills with triggers, token cost and recorded usage |
| `PUT /api/config/skills/file` | Write one editable SKILL.md |
| `GET /api/config/hooks` | Hook entries across settings layers + recorded fires |
| `GET /api/config/hooks/script?path=` | Read a hook's script file |
| `PUT /api/config/hooks/script` | Write a hook's script file |
| `DELETE /api/config/hooks` | Remove a hook entry from its settings file |
| `GET /api/config/permissions` | Merged allow/deny/ask rules; `?project=` adds project layers |
| `GET /api/config/mcp` | MCP servers, probe status, tools, schemas, diagnostics |
| `GET /api/config/memory` | Per-project memory stores |
| `GET /api/config/effective` | Merged settings layers; `?project=` selects the project layer |
| `GET /api/config/dependencies` | Dependency graph: nodes, edges, workflow chains, stats |

Write routes only accept paths the matching list endpoint enumerated — see
[architecture › write safety](architecture.md#write-safety).

## Audit and settings

| Route | Description |
|---|---|
| `GET /api/audit` | Machine-readable configuration findings (the audit *page* was folded into the Dashboard and Harness tabs; this endpoint remains) |
| `POST /api/audit/refresh` | Force a re-audit, bypassing the 60s cache |
| `GET /api/audit/thresholds` · `PUT /api/audit/thresholds` | Warning/error thresholds used by the audit |
| `GET /api/audit/pricing` · `PUT /api/audit/pricing` | Per-model reference pricing |
