# MCP server and the usage-review skill

**English** | [简体中文](mcp.zh-CN.md)

The dashboard answers questions you know to ask. The MCP server lets an AI
assistant ask them for you: it exposes the same data — tokens, costs, sessions,
and the whole harness configuration — as callable tools, and the bundled
`ai-usage-review` skill turns that data into ranked, evidence-backed
recommendations.

Both come up with the app. There is no second process to start and no Docker.

---

## Setup

```bash
bun run start
```

That is the whole setup. On startup the app:

1. serves the MCP endpoint at **`http://127.0.0.1:5757/mcp`** on the same port as
   the dashboard (streamable HTTP transport);
2. installs the `ai-usage-review` skill into every detected AI tool's user-scope
   skills directory (`~/.claude/skills/ai-usage-review/` for Claude Code);
3. registers the endpoint with each detected tool by running its own CLI —
   `claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp`.

Every step is idempotent: it prints one line the first time and stays silent on
later runs. Restart your AI tool once so it picks up the new server, then ask it
to review your usage, or run `/ai-usage-review`.

### Verifying

```bash
curl http://127.0.0.1:5757/api/mcp-server     # human-readable: tool list, protocol versions
```

In Claude Code, `/mcp` lists `ai-insights` among the connected servers.

### If automatic registration was skipped

The app prints the exact command to run. It falls back to printing rather than
registering when the tool's CLI is not on `PATH`. For Claude Code:

```bash
claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp
```

### Opting out

| Flag | Effect |
|---|---|
| `--no-provision` | Don't install skills or register the MCP server. The `/mcp` endpoint is still served. |

The MCP endpoint itself is part of the HTTP server and is not separately
disableable; it is read-only and follows the same loopback binding as the rest
of the API.

### Changing the port

Provisioning is keyed on the URL. Start on a different port and the next run
re-registers the server at the new address automatically:

```bash
bun run start --port=8080     # re-registers at http://127.0.0.1:8080/mcp
```

The registered URL always uses `127.0.0.1`, even when `--host=0.0.0.0` is passed
— the client is always on the same machine, and a LAN address must never end up
in a config file.

---

## Connecting other clients

### Claude Code (and anything speaking streamable HTTP)

```bash
claude mcp add --scope user --transport http ai-insights http://127.0.0.1:5757/mcp
```

Done for you by provisioning; the command is here for manual setup.

### stdio-only clients

Some clients only launch MCP servers as subprocesses. A stdio entry point ships
for them:

```bash
bun run mcp        # = bun run mcp-stdio.ts
```

Configure it as a stdio server with command `bun` and args
`["run", "/absolute/path/to/ai-insights/mcp-stdio.ts"]`.

It is fully standalone — it opens the same SQLite cache and refreshes it from
your transcripts on startup, so it works whether or not the dashboard is
running. Pass `--no-scan` to skip that refresh and read the existing cache
(faster start, possibly stale). The two processes coexist through SQLite's WAL
mode.

`bun run build:mcp` compiles it to a standalone binary at
`dist/ai-insights-mcp` for clients that would rather launch an executable.

---

## Tools

Every tool takes an optional **`provider`** argument naming the data source. It
defaults to `claude-code`; pass `all` to aggregate across every registered
source. Unknown ids fail with a message listing the valid ones. The three tools
whose answer cannot vary by source (`list_providers`, `get_pricing`,
`get_thresholds`) omit the argument.

### Usage

| Tool | Returns |
|---|---|
| `list_providers` | Registered data sources with a live `hasData` flag |
| `get_usage_summary` | Today / 7d / 30d totals and cost, cache hit rate, active runs |
| `get_usage_timeseries` | Token trend over a range, bucketed to match it |
| `get_daily_usage` | Day-by-day totals over up to 365 days |
| `get_model_usage` | Totals per model |
| `get_project_usage` | Totals, run and agent counts per project directory |
| `list_runs` | Paginated session list (`limit`, `offset`, `project`, `search`) |
| `get_run` | One run with all its agents |
| `get_run_usage` | Per-run cost breakdown by bucket and model, **plus rendered tuning advice** |
| `get_top_runs` | Sessions ranked by tokens |
| `get_top_turns` | The largest individual API calls |
| `get_mcp_usage` | Estimated tokens per MCP server, with a per-tool breakdown |
| `get_skill_usage` | Recorded skill invocations and their injected tokens |
| `list_agents` | Agents with model, turn count and token totals |

### Harness configuration

| Tool | Returns |
|---|---|
| `get_harness_capabilities` | Which config sections this provider's adapter supports |
| `list_instruction_files` | Instruction files with token counts and the 30-day injection series |
| `read_instruction_file` | Full text of one enumerated instruction file |
| `list_commands` | Slash commands from all sources, with override marking |
| `list_skills` | Skills with triggers, token cost and **recorded** 30-day usage |
| `list_hooks` | Hook entries across settings layers with **recorded** fire counts |
| `read_hook_script` | Source of a hook's script file |
| `get_permissions` | Merged allow / deny / ask rules with shadowing marked |
| `list_mcp_servers` | Configured MCP servers, probe status, tools, schema token cost |
| `list_memory_stores` | Per-project memory stores with orphan detection |
| `get_effective_config` | Merged settings layers, overrides, ignored-layer warnings |
| `get_dependency_graph` | How skills, hooks, MCP servers and commands reference each other |
| `list_config_projects` | Project directories discovered from transcripts |

### App settings

| Tool | Returns |
|---|---|
| `get_pricing` | The per-model reference price table behind every cost figure |
| `get_thresholds` | Configured warn/error thresholds |

### Payload discipline

Tools that could return whole files return metadata only by default:

| Tool | Flag | Default |
|---|---|---|
| `list_skills`, `list_commands` | `includeContent` | `false` — bodies omitted |
| `list_mcp_servers` | `includeSchemas` | `false` — JSON schemas omitted |
| `get_run_usage` | `includeSeries` | `false` — per-call series replaced by its length |

File contents are truncated at 20,000 characters with an explicit marker. A
tool built to diagnose context bloat should not cause it.

---

## What is deliberately *not* exposed

The MCP surface is **read-only**. These HTTP routes have no tool:

| Not exposed | Why |
|---|---|
| `PUT /api/config/instructions/file` | Silently rewriting CLAUDE.md from an analysis run is a footgun |
| `PUT/POST/DELETE /api/config/commands` | Same — commands are user-authored config |
| `PUT /api/config/skills/file` | Same, and a skill that edits skills can edit itself |
| `PUT/DELETE /api/config/hooks*` | Hooks execute shell commands; writing them needs a human in the loop |
| `PUT /api/settings/thresholds` | Changing thresholds would let a review move its own goalposts |
| `GET /api/agent/:id`, `GET /api/agent/:id/tree` | Full transcripts and render-ready session trees, tens of thousands of tokens each, shaped for the UI. Use `get_run_usage` for the same session's costs |

Recommendations come back as text, and the user's own assistant applies them
with its normal, permission-gated edit tools — where they show up as a diff and
can be refused. That is the point: the review proposes, the human disposes.

---

## Security

- Bound to loopback, like the rest of the API.
- **Origin validation** on every MCP request: a request carrying a non-loopback
  `Origin` header is rejected with 403, which blocks DNS-rebinding attacks from
  a web page. Native clients send no `Origin` and pass through.
- `GET /mcp` and `DELETE /mcp` answer `405` — the server offers no
  server-initiated SSE stream and holds no sessions.
- Unsupported `MCP-Protocol-Version` headers are rejected with 400.

The server is stateless: no `Mcp-Session-Id` is issued, every POST stands alone,
and each JSON-RPC request is answered with a single `application/json` body.
Protocol revisions `2025-06-18` (default), `2025-03-26` and `2024-11-05` are
negotiated at `initialize`.

---

## The `ai-usage-review` skill

Installed to `~/.claude/skills/ai-usage-review/` (and the equivalent directory of
any other detected tool). Source of truth lives in
[`assets/skills/ai-usage-review/`](../assets/skills/ai-usage-review/) — edit it
there and restart the app to push the update.

Invoke it with `/ai-usage-review`, or just ask: *"review my Claude Code usage"*,
*"why are my sessions so expensive?"*, *"should this be a skill or a hook?"*

### What it does

1. Resolves which provider to look at (`list_providers`), then scopes every call.
2. Gathers in a fixed order — shape of spend → waste signals → per-session detail
   → always-on context → extension ROI → determinism gaps → correctness — and
   stops as soon as the findings are supported.
3. Runs eleven checks from `references/playbook.md`, each with a measurement, a
   threshold, a fix, and a rule for sizing the saving from real numbers.
4. Reports at most seven findings ranked by estimated saving, each citing the
   tool call it came from, and closes with a "do this first".
5. Offers to apply the mechanical ones with your assistant's own edit tools.

### The checks

| # | Check | Fires on |
|---|---|---|
| C1 | Instruction files taxing every turn | A file over ~2,000 tokens, or >2M injected tokens in 30 days |
| C2 | Premium models doing routine work | Premium tier over 50% of tokens |
| C3 | Prompt cache not being hit | Under 50% over 30 days; under 30% on a run |
| C4 | Sessions carrying too much context | A single call over 200k tokens, or one run over 20% of the period |
| C5 | Skills that don't pay for themselves | Zero calls in 30 days, shadowed by an override, or large body / low use |
| C6 | MCP servers costing more than they return | >2,000 schema tokens with zero calls; probe errors |
| C7 | Rules that should be hooks; hooks that are dead | "Always"/"never" rules in prose; hooks with zero fires |
| C8 | Repeated work that should be a skill | The same task shape 3+ times in 30 days |
| C9 | Sub-agent-heavy runs | Sub-agents over 60% of a run's tokens |
| C10 | Permission allowlist too thin | Daily-driver commands missing from `allow` |
| C11 | Settings that do nothing | Keys in ignored layers, shadowed commands/skills, orphaned memory |

A symptom index maps user complaints ("I keep running out of context", "it keeps
asking permission", "it ignores my rules") to the checks that explain them.

### Files

```
assets/skills/ai-usage-review/
  SKILL.md                 The workflow: scope → gather → diagnose → report → apply
  references/
    playbook.md            The 11 checks: signal, threshold, fix, how to size the saving
    authoring.md           How to build the fix: skill vs hook vs sub-agent vs CLAUDE.md
```

`SKILL.md` stays short on purpose — a skill's body sits in context for the rest
of the turn once loaded. The two references are read only when needed.
