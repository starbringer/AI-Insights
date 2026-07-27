# Data model

**English** | [简体中文](data-model.zh-CN.md)

- [Run / Agent / Turn](#run--agent--turn)
- [Accuracy notes](#accuracy-notes)
- [Database](#database)
- [Cost estimation](#cost-estimation)

## Run / Agent / Turn

Recorded activity is organized into three nested levels:

- **Run** — one logical execution (one AI session). May contain one or many agents.
  A plain chat with no sub-agents holds exactly one agent; an orchestrator that
  spawns Task sub-agents holds the parent plus all descendants, linked through the
  provider's native parent/child markers.
- **Agent** — one conversation context. Maps to a single transcript file (one
  `.jsonl` for Claude Code). Has a model, a cwd, a title and a list of turns.
- **Turn** — one **API call** (one LLM request/response).

Sub-agents are detected from the provider's own data — for Claude Code that's the
`<parent>/subagents/agent-*.jsonl` directory convention. No heuristics, no content
sniffing. If a framework doesn't record parent/child links between transcript
files, each transcript becomes a one-agent run; that's correct behavior, not a
limitation.

## Accuracy notes

**Token dedupe.** Claude Code writes one JSONL line per *content block* of a
response, and every line repeats the same `usage` numbers. Turns are deduplicated
by the response's `message.id`, so each API call is counted exactly once. Without
that dedupe, real transcripts over-count output tokens by roughly 2.4× (more for
sessions with heavy tool use). All totals, charts and cost estimates use the
deduplicated numbers.

**Failed calls.** Error echoes recorded with model `<synthetic>` are excluded from
counts and from the model list; they appear in the session tree as error nodes.

**Day boundaries.** "Today" and daily buckets use your local calendar day, not UTC.

**Titles.** A run is titled by the transcript's `ai-title` record (Claude Code's own
AI-generated session title) when present; otherwise by the first real user prompt,
with IDE/framework wrapper tags stripped.

**Cache write TTL.** The 5m/1h split comes from `usage.cache_creation`. Legacy
records carrying only a total are attributed to the 5m bucket (the default TTL) so
cost is not overstated.

**Recorded vs estimated.** Fire counts, tool calls and skill invocations come from
the parsed event stream — they are recorded, not inferred. Anything labelled *est.*
in the UI (MCP/skill token usage, injected prompt cost) is a tokenizer estimate.

## Database

SQLite at `data/cache.db` in WAL mode. Five tables, each carrying a `provider`
column for multi-source support.

| Table | Row = | Notes |
|---|---|---|
| **`files`** | one transcript file | path + byte offset, for incremental parsing |
| **`runs`** | one logical run | derived roll-up: title, cwd, agent count, turn count, first/last seen. Rebuilt after every full scan **and** every incremental ingest (debounced), so the Runs page stays live without a restart |
| **`agents`** | one transcript file | `run_id`, `parent_agent_id`, `parent_turn_index` (sibling ordering), `agent_type`, `description` (from sub-agent `meta.json`), title, cwd, last seen, turn count |
| **`turns`** | one API call | **unique on (agent_id, message_id)** — this index is what deduplicates the one-line-per-content-block format. Carries model, token counts, timestamp, and a `bucket` column (0 = base, 1 = MCP, 2 = skill, assigned at parse time from the call's `tool_use` blocks; sub-agent attribution uses `is_subagent`) |
| **`events`** | one parsed event | idempotent on (agent_id, source uuid): user prompts, tool calls (with tool name and `tool_use_id`), hook fires, API errors, compactions, model fallbacks. Tool events also carry an estimated token size and, for Skill calls, the skill name |

`turns` is the source of truth for token totals, turn counts and last-seen times —
all recomputed from it, never trusted from a maintained counter. (Incremental
parsing of timestamp-less trailing records like `ai-title`, `mode` or `summary`
would otherwise zero out turn counts or null out `last_seen_at`.)

**Schema versioning.** The schema version is stored in `PRAGMA user_version`. When
the app starts and finds a different version it drops and recreates everything,
then re-parses every transcript. Deleting `data/cache.db` forces the same rebuild.
A rebuild is safe at any time: the JSONL transcripts are the only source of truth.

## Cost estimation

Costs are **API-equivalent reference numbers**, not billing. Each turn's tokens are
priced with a per-model table (input / output / cache-write / cache-read per
million tokens) that you can edit on the **Settings** page or directly in
`data/pricing.json`. Cache writes are priced 1.25× input for the 5-minute TTL and
2× for the 1-hour TTL; cache reads 0.1× input.

If you are on a Pro/Max subscription these numbers tell you what the same work
would have cost through the API — they are not what you are charged. Anthropic
provides no programmatic API for subscription seat usage; see
<https://claude.ai/settings/usage> for that.
