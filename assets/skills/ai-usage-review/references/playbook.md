# Diagnosis playbook

Each check below is: **signal → threshold → why it costs → fix → how to size the
saving.** Run every check whose input data you gathered; skip the rest silently.

Thresholds are starting points, not laws. A number just under a threshold with a
clear upward trend is still a finding; a number just over it on a one-off day is
not.

## Symptom index

Lead with these checks when the user names a problem.

| User says | Check first |
|---|---|
| "It costs too much" | C1, C2, C3, C6 |
| "I keep running out of context" | C1, C4, C5, C9 |
| "It's slow to start / every turn is expensive" | C1, C4, C6 |
| "It ignores my instructions" | C1 (bloat drowns rules), C7 (make it a hook) |
| "It keeps asking permission" | C10 |
| "I keep repeating the same task" | C8 |
| "My skill never triggers" | C5 |
| "My setting does nothing" | C11 |

---

## C1 — Instruction files are taxing every turn

**Signal** `list_instruction_files` → per-file `tokens`, and
`injection.estimatedInjectedTokens30d`.

**Threshold** A single always-injected file over **2,000 tokens** (≈200 lines),
or 30-day injected tokens above **2M**.

**Why it costs** Instruction files load at the start of every session and sit in
the prefix of every request in it. The cost is `tokens × requests`, not
`tokens × sessions` — which is why a 4,000-token CLAUDE.md is a five-figure
monthly token line on its own. Past a point it also *reduces* adherence: rules
get lost in the noise, which is the real complaint behind "it ignores my rules".

**Fix** `read_instruction_file` on the largest, then classify every section:

| Keep in the instruction file | Move out |
|---|---|
| Commands that can't be guessed (`bun run test`, not `npm test`) | Any procedure with numbered steps → a skill |
| Style rules that differ from the language default | Anything true of the language generally |
| Repo etiquette (branch naming, PR rules) | API documentation → link to it |
| Environment quirks and gotchas | File-by-file descriptions of the codebase |
| Architectural decisions specific to this repo | "Write clean code"-grade advice |

Rule of thumb for each line: *would removing this cause a mistake?* If not, cut.
Sections that describe a repeatable workflow become a skill — a skill's body is
free until it is invoked.

**Sizing** `(tokens_removed / tokens_now) × estimatedInjectedTokens30d`, priced
with `get_pricing` at the model from `get_model_usage`.

---

## C2 — Premium models doing routine work

**Signal** `get_model_usage`; `get_run_usage` on top runs returns a
`switch-cheaper-model` advice item with an exact re-priced saving.

**Threshold** Premium-tier models over **50%** of tokens, when the work is not
obviously architecture or hard debugging.

**Why it costs** Output and cache-write tokens are several times more expensive
on the premium tier. Routine edits, test runs and file reads do not need it.

**Fix** Set a cheaper default and escalate deliberately, rather than the reverse.
Check `get_effective_config` for the configured default model and which layer
sets it. For sub-agents, set a cheap model in the agent definition — verbose
read-heavy work is exactly what a small model should do.

**Sizing** Take the `usd` field of the `switch-cheaper-model` advice for each of
the top runs and scale by that run's share of 30-day tokens. Never state a
percentage the tools did not produce.

---

## C3 — Prompt cache is not being hit

**Signal** `get_usage_summary` → `cacheHitRate30dPct`; `get_run_usage` →
`low-cache-hit` advice; `get_usage_timeseries` → bars where cache-write is high
and cache-read is near zero.

**Threshold** Under **50%** over 30 days is worth investigating; under **30%** on
a specific run is a finding.

**Why it costs** A cache read is roughly a tenth the price of processing the same
tokens fresh. Anything that changes the stable prefix of a request invalidates
the cache for the rest of the session: editing CLAUDE.md mid-session, adding or
removing an MCP server, switching model. Idle gaps longer than the cache lifetime
have the same effect.

**Fix**
- Make instruction-file edits between sessions, not during them.
- Keep the MCP server set stable within a session; disable unused servers once,
  not repeatedly.
- Prefer one focused session over resuming a stale one after hours away — a
  resume after a long gap reprocesses the whole context at full price.
- Split unrelated work into separate sessions instead of one long mixed one.

**Sizing** `cacheRead` tokens that *should* have been cache reads, priced at the
gap between the write and read rates in `get_pricing`.

---

## C4 — Sessions carry too much context

**Signal** `get_top_turns` (single calls far above the median),
`get_top_runs` + `get_run` (runs with very high turn counts),
`get_run_usage` → `subagents-heavy`.

**Threshold** A single API call above **200k** total tokens, or one run above
**20%** of the period's tokens.

**Why it costs** The whole conversation is re-sent on every turn, so one large
tool result early in a session is paid for on every call after it. Long mixed
sessions are the most common cause of surprise spend.

**Fix**
- Clear context between unrelated tasks rather than carrying it.
- Delegate read-heavy investigation to sub-agents: verbose output stays in the
  sub-agent's context and only the summary returns.
- Filter noisy command output at the source (see C7) instead of reading it whole.
- Scope investigation prompts to directories and files rather than "look into X".

**Sizing** Compare the median turn size to the outliers; the excess, multiplied
by the turns that followed it in that run, is the recoverable amount.

---

## C5 — Skills that don't pay for themselves

**Signal** `list_skills` (`tokens`, `calls30d`, `estTokens30d`, `triggers`,
`overriddenBy`) cross-referenced with `get_skill_usage`.

**Thresholds**
- `calls30d === 0` on a skill that has existed for a while → never triggers.
- `overriddenBy` set → a same-named skill at a higher-priority scope wins; this
  one is dead weight and a source of confusion.
- Large `tokens` with low `calls30d` → the body is doing too much for how often
  it is needed.

**Why it costs** A skill's body enters context when invoked and stays there for
the rest of the turn. A never-invoked skill costs only its description line — but
a wrong description is worse than no skill, because the work it was meant to
capture is being redone by hand every time.

**Fix**
- Never fires → rewrite the `description`. It is the *only* thing the model sees
  when deciding to load a skill. Put the use case first and name the words a user
  would actually type. Compare against the `triggers` the dashboard extracted: if
  they are not the words the user uses, that is the bug.
- Overridden → delete the shadowed copy or rename it.
- Large and rarely used → move the bulk into `references/` files the skill reads
  on demand, leaving a short body. See `authoring.md`.

**Sizing** For a fixed description, the saving is the avoided rework, not tokens;
say so rather than inventing a number.

---

## C6 — MCP servers costing more than they return

**Signal** `list_mcp_servers` (`toolCount`, `schemaTokens`, `probeError`) against
`get_mcp_usage` (`calls`, `tokens` per server and per tool).

**Thresholds**
- A server with `schemaTokens` above ~2,000 and **zero** calls in 30 days.
- A single tool responsible for most of a server's token volume.
- Any `probeError` — a server that cannot be probed is usually broken for the
  tool too.

**Why it costs** Tool definitions are deferred in recent Claude Code versions, so
names enter context but full schemas load on use. Even so, an unused server adds
listing overhead, startup latency and a way for the model to pick the wrong tool.
Per-call payloads are the larger cost: `get_mcp_usage` reports the actual tokens
each server's calls injected.

**Fix**
- Disable servers with no calls.
- Where a CLI exists for the same job (`gh`, `aws`, `gcloud`, `docker`), prefer
  it: a CLI adds no per-tool listing cost and returns exactly what was asked for.
- For a single heavy tool, narrow the query it is called with, or wrap it in a
  skill that specifies the arguments that return less.
- Fix or remove servers with a `probeError`.

**Sizing** Sum the 30-day `tokens` for the servers being removed, priced with
`get_pricing`.

---

## C7 — Rules that should be hooks; hooks that are dead

**Signal** `list_hooks` (`fires30d`, `matcher`, `event`, `scriptPath`),
`read_hook_script`, plus instruction files read in C1.

**Thresholds**
- A hook with `fires30d === 0` → the matcher does not match anything, or the
  hook is obsolete.
- An instruction-file rule phrased as "always" / "never" / "every time" → it
  belongs in a hook, not in prose.

**Why it costs** Instruction-file rules are advisory: they cost tokens on every
turn and are followed most of the time. A hook costs zero tokens and is followed
every time. Converting one both removes a line from C1's tax and removes a
failure mode.

Hooks also cut context directly: a `PreToolUse` hook that filters a test command
down to its failures turns a 10,000-line log into a handful of lines.

**Fix**
- Zero fires → read the script, check the matcher against the tool names actually
  used in `list_hooks`/`get_dependency_graph`, then fix or delete the entry.
- "Must always happen" rules → propose the hook (event, matcher, command) and
  offer to write it.
- Verbose recurring command output → propose an output-filtering hook.

**Sizing** For filtering hooks, estimate from `get_top_turns`: the tokens of the
outlier calls the filter would have shrunk.

---

## C8 — Repeated work that should be a skill or command

**Signal** `list_runs` and `get_project_usage`: titles that repeat, several runs
in one project with near-identical shape and similar token totals.

**Threshold** The same task shape appearing **3+ times** in 30 days.

**Why it costs** Every repetition re-derives the same context: the same files
read, the same conventions rediscovered, the same corrections given. That is
paid in full each time.

**Fix** Capture it once:

| Repetition looks like | Build |
|---|---|
| A multi-step procedure you re-type | A skill with `disable-model-invocation: true`, invoked as `/name` |
| Knowledge you keep re-explaining | A skill Claude loads on its own (good `description`, no invocation flag) |
| A one-line prompt with an argument | A skill using `$ARGUMENTS` / `argument-hint` |
| Something that must happen every time | A hook (see C7) |
| Read-heavy investigation | A sub-agent definition with a cheap model |

`authoring.md` has the templates. Cross-check `get_dependency_graph` first: the
capability may already exist and simply not be triggering (that is C5, not C8).

**Sizing** `median run tokens for that shape × occurrences × the fraction the
skill removes` — usually the exploration phase, not the edit phase.

---

## C9 — Sub-agent-heavy runs

**Signal** `get_run_usage` → `byBucket.subagents`, and the `subagents-heavy`
advice item.

**Threshold** Sub-agents above **60%** of a run's tokens.

**Why it costs** Each sub-agent runs its own context window and loads the
instruction files and skill listings all over again. Fan-out multiplies the
fixed per-session cost by the number of agents.

**Fix** This is not automatically bad — delegation is how you keep the main
context clean. It *is* a finding when: sub-agents run a premium model for
mechanical work (give them a cheap one), spawn counts are high for small tasks
(inline them), or C1 is also firing (every sub-agent re-pays the instruction tax,
so trimming instruction files is worth N× more here).

**Sizing** `byBucket.subagents.costUsd` re-priced at a cheaper model, using
`get_pricing`.

---

## C10 — Permission allowlist too thin

**Signal** `get_permissions` → `effective`, plus `layers` to see where rules live.

**Threshold** A short `allow` list next to daily-driver commands that are absent
from it (the project's own test, build, lint and typecheck commands — read them
from the project config or the instruction files gathered in C1).

**Why it costs** Not tokens — attention. Every prompt is an interruption, and a
user who has clicked approve twenty times is no longer reviewing.

**Fix** Add narrowly-scoped allow rules for the specific safe commands this
project runs constantly. Scope them to the command, not the tool: allow the exact
test command rather than all shell access. Keep destructive operations out.

**Sizing** State it as interruptions avoided, not tokens.

---

## C11 — Settings that do nothing

**Signal** `get_effective_config` → entries with `sourceIgnored` or
`ignoredLevels`; `list_commands` and `list_skills` with `overriddenBy`;
`list_memory_stores` → topics with `referenced: false`.

**Threshold** Any occurrence.

**Why it costs** Silent no-ops. The user believes a setting is in force, plans
around it, and is wrong — the most expensive kind of misconfiguration because it
is invisible until something breaks.

**Fix** Move the key to a layer the tool reads; delete or rename shadowed
commands and skills; link orphaned memory topics from the index file or delete
them.

**Sizing** None. Report as correctness, and rank above small savings — a wrong
belief about your config outlasts any single month's spend.
