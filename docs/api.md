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

**Every read route accepts `?provider=<id>`** to select the data source:

| Value | Meaning |
|---|---|
| *omitted* | The default provider — the first registered one (`claude-code` today) |
| `<id>` | That provider only |
| `all` | No filter: aggregate across every registered provider |
| anything else | `400` with a message listing the valid ids |

On `/api/config/*`, `all` collapses to the default adapter — configuration is
inherently per-tool. Routes that address a single run or agent by id resolve the
owning provider from the record itself; `?provider=` there acts as an assertion
and `404`s on a mismatch.

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
| `GET /api/config/effective` | Merged settings layers; `?project=` selects the project layer. Keys Claude Code accumulates rather than overrides (`permissions.allow` / `deny` / `ask`) return every layer's rules concatenated and carry `mergedLevels` instead of `overriddenLevels` |
| `GET /api/config/dependencies` | Dependency graph: nodes, edges, workflow chains, stats |

Write routes only accept paths the matching list endpoint enumerated — see
[architecture › write safety](architecture.md#write-safety).

## Settings

| Route | Description |
|---|---|
| `GET /api/settings/thresholds` · `PUT /api/settings/thresholds` | Warning/error thresholds behind the ok/warn/error badges on the Harness tabs. `PUT` merges the keys you send and persists to `data/thresholds.json` |
| `GET /api/settings/pricing` | Per-model reference pricing that drives every cost number. Read-only over HTTP — edit `data/pricing.json` to change it |

## MCP

| Route | Description |
|---|---|
| `POST /mcp` | Model Context Protocol endpoint, streamable HTTP transport. Stateless: one JSON-RPC message in, one `application/json` response out; notifications answer `202` |
| `GET /mcp` · `DELETE /mcp` | `405` — no server-initiated SSE stream, no sessions to terminate |
| `GET /api/mcp-server` | Human-readable summary: protocol versions, tool count, and every tool's name and description |

`POST /mcp` rejects a non-loopback `Origin` header with `403` (DNS-rebinding
defence) and an unsupported `MCP-Protocol-Version` header with `400`. The tools
are read-only and each accepts the same `provider` argument as the routes above
— see [docs/mcp.md](mcp.md).
