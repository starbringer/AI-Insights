# Architecture

How the app is put together, and where to plug in a new AI tool.

- [Two provider seams](#two-provider-seams)
- [Transcript providers](#transcript-providers)
- [Config adapters (the Harness tabs)](#config-adapters-the-harness-tabs)
- [Adding a new provider](#adding-a-new-provider)
- [MCP: why config files, not the CLI](#mcp-why-config-files-not-the-cli)
- [Write safety](#write-safety)
- [Network binding](#network-binding)
- [Token estimation](#token-estimation)

## Two provider seams

Everything tool-specific lives behind one of two interfaces. The API layer, the
aggregations and the entire UI only ever see neutral shapes.

| Seam | Interface | Answers |
|---|---|---|
| **Transcript provider** | [`src/providers/types.ts`](../src/providers/types.ts) | Where is the usage data, how do I parse it into runs/agents/turns? |
| **Config adapter** | [`src/config/types.ts`](../src/config/types.ts) | What is the tool configured with — instructions, commands, skills, hooks, MCP, permissions, memory, settings? |

A tool can implement one, the other, or both. Claude Code implements both;
a future Codex/OpenCode/Cline adapter can implement any subset.

## Transcript providers

```ts
export interface Provider {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData(): boolean;
  watchGlobs(): string[];                      // patterns the watcher should mind
  fileMatches(path: string): boolean;          // does this path belong to this provider?
  scanAll(db): void;                           // startup full scan
  ingestFile(db, path): void;                  // incremental update for one file
  loadAgentDetail(agentId): NormalizedTurn[];  // detail page rows
}
```

The registry in [`src/providers/index.ts`](../src/providers/index.ts) lists every
provider; `providerForPath(path)` routes changed files to the right one.
`GET /api/providers` exposes the list to the UI with a `hasData` flag computed at
request time — that's what fills the **Source ▾** switcher in the top bar.

The watcher, aggregations, pricing and UI are provider-agnostic: they only operate
on rows in SQLite and on `NormalizedTurn` objects. Pricing keys off the model
name, so any provider whose turns carry a recognizable model string gets costs for
free.

### Claude Code

[`src/providers/claude-code/`](../src/providers/claude-code/) reads
`~/.claude/projects/**/*.jsonl`. Conventions it recognizes:

- **Multi-line responses** — one API response spans several `assistant` lines (one
  per content block) sharing `message.id`; grouped into a single turn.
- **`<synthetic>` error echoes** (`isApiErrorMessage`) — excluded from usage,
  rendered as error nodes in the session tree.
- **`system` lines** — `stop_hook_summary` (hook fires), `api_error` (retries),
  `compact_boundary` (context compaction, re-linked through `logicalParentUuid`),
  `model_refusal_fallback`, `turn_duration`.
- **`attachment` lines** — todo reminders, deferred tool loads, IDE state; shown as
  injected-context nodes.
- **`ai-title` lines** — preferred source for run titles.
- **uuid/parentUuid branching** — prompt edits and retries; the mainline is the
  path with the latest descendant, side paths become collapsed branch sub-trees.
- **Sub-agent transcripts** at `<parent-agent-id>/subagents/agent-*.jsonl` plus
  in-file sidechains (`isSidechain`).
- **`sourceToolUseID`** — links injected content (skill bodies) back to the tool
  call that produced it.

No API keys are needed; all parsing is local.

## Config adapters (the Harness tabs)

```ts
export interface ToolConfigAdapter {
  providerId: string;
  capabilities(): CapabilityFlags;
  listInstructionFiles?(db): InstructionFile[];
  getInstructionsReport?(db): InstructionsReport;
  readInstructionFile?(path): string;
  writeInstructionFile?(path, content): void;
  listCommands?(db): CommandInfo[];
  // …skills, hooks (+ script read/write/delete), permissions, mcp, memory, effective
}
```

Every method is optional. `capabilities()` reports what this adapter can do, and
`GET /api/config/capabilities` hands that to the UI — a tab only renders if the
active provider declares the capability, and any `/api/config/*` route whose
capability is missing answers `501`.

- Registry: [`src/config/index.ts`](../src/config/index.ts)
- Neutral shapes: [`src/config/types.ts`](../src/config/types.ts)
- Claude Code's implementation: [`src/providers/claude-code/config/`](../src/providers/claude-code/config/)
- Dependency graph builder: [`src/config/graph.ts`](../src/config/graph.ts) — itself
  provider-agnostic, it consumes the adapter's neutral output and never touches
  tool-specific files. Edges are either **content references** (a skill's text
  naming `mcp__server__tool`, drawn solid) or **name-keyword similarity** (drawn
  dashed); connected components become the workflow chains, ordered
  hook → MCP → skill → command.

Claude Code specifics the adapter handles internally: three config sources
(user > project > plugin) with override ranking, `:`-namespaced command names,
settings layering (local > project > user) including keys the tool only reads from
one layer (`autoMode`, `pluginConfigs` are user-only since Claude Code 2.1.207),
and YAML frontmatter parsing with block scalars.

## Adding a new provider

**Usage data (Dashboard, Runs, Run detail):**

1. Create `src/providers/<id>/index.ts` exporting an object implementing `Provider`.
2. Write a parser that walks `dataDir` and upserts rows via the helpers in
   [`src/transcripts/cache.ts`](../src/transcripts/cache.ts), plus a detail loader
   returning `NormalizedTurn[]`.
3. Append the object to `PROVIDERS` in [`src/providers/index.ts`](../src/providers/index.ts).

**Configuration (Harness tabs):**

1. Create a `ToolConfigAdapter` for the tool — implement only the capabilities that
   make sense for it.
2. Register it in `CONFIG_ADAPTERS` in [`src/config/index.ts`](../src/config/index.ts).
3. Nothing else. The tabs, routes and graph adapt to whatever `capabilities()` says.

## MCP: why config files, not the CLI

Earlier versions shelled out to `claude mcp list` and parsed its human-readable
output. That broke repeatedly without any code change: the CLI health-checks every
server before printing (so one slow server or a cold network blanked the whole list
past the spawn timeout), and its output format drifts between CLI versions.

The MCP tab instead reads the same files the CLI reads (`~/.claude.json`,
`.mcp.json`), which is deterministic and instant. Only the optional tool/schema
probes contact the servers; results are cached for 10 minutes per config
definition, and any failure is surfaced in the diagnostics panel.

**Probe consent.** Project-scope servers ship inside a repo's `.mcp.json` —
third-party content that Claude Code itself only runs after you approve it per
project. The tab mirrors that: unapproved or disabled project servers are *listed*
with their scope but never executed or contacted, and their row explains why no
tool data is shown. claude.ai-hosted connectors are listed by name only, since
their definitions live in your account rather than on disk.

## Write safety

The only write paths are the CLAUDE.md editor, the command editor/creator/deleter,
the skill editor, the hook-script editor and hook removal.

Every write is validated server-side against the file set the adapter itself
enumerated: a hook script must be referenced by an enumerated hook, a hook removal
must target an enumerated entry, an instruction/skill/command file must be one of
the files the corresponding list endpoint returned. Path comparison is case-folded
on Windows. The API cannot write an arbitrary path, and plugin-owned files are
always read-only.

## Network binding

The server binds `127.0.0.1` by default. Because the config API can edit files on
disk, exposing it on a LAN would turn any page on the network — or any prompt that
can reach it — into a file writer. Override deliberately with `--host=0.0.0.0` or
`HOST=0.0.0.0` if you know you want that.

## Token estimation

Prompt-injection cost (CLAUDE.md size, hook payloads, MCP schemas, skill bodies)
is estimated with [`js-tiktoken`](https://github.com/dqbd/tiktoken) using the
`cl100k_base` encoding, which runs locally in WASM. Recorded token *usage* is never
estimated — it comes from the transcripts' own `usage` numbers.
