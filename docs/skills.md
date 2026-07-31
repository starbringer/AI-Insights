# The bundled skills

**English** | [简体中文](skills.zh-CN.md)

Two skills ship with the app and form one loop: **`ai-usage-review`** finds what
is costing you, **`ai-change-impact`** proves whether the fix worked. Both read
the [MCP server](mcp.md) and neither writes — they propose, your assistant
applies through its own permission-gated edit tools.

They are separate skills because the trigger phrases are disjoint: one is asked
before a change, the other after. A single skill covering both would trigger
reliably for neither.

---

## Install and update

Both are installed on startup into every detected AI tool's user-scope skills
directory — `~/.claude/skills/ai-usage-review/` and
`~/.claude/skills/ai-change-impact/` for Claude Code. Source of truth is
[`assets/skills/`](../assets/skills/): edit there, restart the app to push the
update. Restart your AI tool once after first install so it picks up the skills.

Opt out with `--no-provision`; `/mcp` is still served.

---

## `ai-usage-review`

### How to invoke

`/ai-usage-review`, or just ask. The skill triggers on the words you would
actually type:

| You want | Ask |
|---|---|
| A full audit | `/ai-usage-review` |
| A narrowed audit | `/ai-usage-review why are my sessions so expensive?` |
| Cost focus | *"what's costing me the most?"*, *"cut my token spend"* |
| A symptom explained | *"I keep running out of context"*, *"it keeps asking permission"*, *"it ignores my rules"* |
| A design decision | *"should this be a skill or a hook?"*, *"what belongs in CLAUDE.md?"* |
| A skill that won't fire | *"why doesn't my skill trigger?"* |

Naming a symptom is worth doing — the skill maps complaints to the checks that
explain them and leads with those instead of walking all eleven.

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
| C1 | Instruction files taxing every turn | A file over ~2,000 tokens, or >2M injected tokens over the window |
| C2 | Premium models doing routine work | Premium tier over 50% of tokens |
| C3 | Prompt cache not being hit | Under 50% over the window; under 30% on a run |
| C4 | Sessions carrying too much context | A single call over 200k tokens, or one run over 20% of the period |
| C5 | Skills that don't pay for themselves | Zero calls in the window, shadowed by an override, or large body / low use |
| C6 | MCP servers costing more than they return | >2,000 schema tokens with zero calls; probe errors |
| C7 | Rules that should be hooks; hooks that are dead | "Always"/"never" rules in prose; hooks with zero fires |
| C8 | Repeated work that should be a skill | The same task shape 3+ times inside the window |
| C9 | Sub-agent-heavy runs | Sub-agents over 60% of a run's tokens |
| C10 | Permission allowlist too thin | Daily-driver commands missing from `allow` |
| C11 | Settings that do nothing | Keys in ignored layers, shadowed commands/skills, orphaned memory |

### What a finding looks like

Every finding carries the measurement it came from, so you can check it rather
than trust it:

```
### Global CLAUDE.md is taxing every turn — ~$41/month
**Measured:** list_instruction_files — ~/.claude/CLAUDE.md is 3,180 tokens and
was injected 4.1M times over the 30-day window.
**Why it costs:** It sits in the prefix of every request of every session, so the
cost is tokens × requests, not tokens × sessions.
**Fix:** Move the four numbered release-process steps into a skill; keep the
build commands and the branch-naming rule. ~1,700 tokens removed.
**Effort:** 10 minutes
```

The report ends with a **do this first** line naming the best saving-to-effort
ratio, and a line on what was checked and found healthy — so you know the absence
of a finding was measured, not skipped.

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

---

## `ai-change-impact`

### How to invoke

| You want | Ask |
|---|---|
| It to pick the mode | `/ai-change-impact` |
| Two specific sessions | `/ai-change-impact r-9f3a r-4d81` |
| Two sessions, in words | *"compare run r-9f3a with r-4d81"* |
| A verdict on one change | *"did trimming CLAUDE.md help?"*, *"was that worth it?"* |
| Two time periods | *"is my setup cheaper than last week?"* |
| Proof for a review's estimate | *"prove that fix paid off"* |

Run ids come from the **Runs** page — click one to copy — or from `list_runs`.
Any unique prefix works, so `r-9f3a` is as good as `r-9f3a1c2b7e04`. Order does
not matter: the earlier-starting run is always the baseline, so you cannot get
the sign backwards by typing them the wrong way round.

### What it does

1. Picks the mode: two runs by id, or two periods. Does both when it can, since
   agreement between them is the strongest evidence available.
2. Checks `get_data_retention` **before** asking for a window, and refuses
   honestly when the "before" side has already been deleted rather than quietly
   answering a narrower question.
3. Calls `get_harness_changes` to *offer* the split point instead of asking the
   user to remember when they made the change.
4. Runs `compare_runs` or `compare_periods`, then attributes the delta to the
   driver that moved it and cross-checks that against the harness diff — a
   context saving next to a shrunk CLAUDE.md is a causal story; a volume saving
   next to an unchanged harness is probably just an easier task.
5. Reports with an explicit confidence level, and states "no measurable
   difference" when the delta is inside the noise.

### Which mode to use

| | Two sessions | Two periods |
|---|---|---|
| **Use when** | You re-ran the same task on purpose | You just kept working |
| **Strength** | Exact — same work, both sides | Averages out task difficulty |
| **Weakness** | n = 1; task difficulty and cache state also moved | Confounded by whatever else changed |
| **Ask** | *"compare r-9f3a and r-4d81"* | *"compare this week against last week"* |

### Reading the three drivers

The cost difference is split into three factors that **sum exactly** to it:

| Driver | Means | Usually caused by |
|---|---|---|
| **Volume** | You made more or fewer API calls | Task size, or a workflow that needed fewer turns |
| **Tokens per call** | Each call carried more or less context | A CLAUDE.md edit, tighter file reads, sub-agent delegation |
| **Price per token** | The model and cache blend repriced them | A model switch, or a cache hit-rate change |

Which one moved is the whole answer. A context saving next to a shrunk CLAUDE.md
is causal. A volume saving with an unchanged harness usually just means the second
task was easier — and the skill will say so rather than take credit:

```
$107.84 → $42.44 (−60.6%) across 368 → 251 API calls.

Volume            −$34.29  (52%)   368 → 251 calls
Price per token   −$18.18  (28%)   blended rate −30%
Tokens per call   −$12.94  (20%)   259,548 → 213,899

Confidence: low. These are different tasks, not a re-run, and the harness diff is
empty — so most of the volume term is task size, not an improvement. The
defensible number is cost per call: −42%.
```

### Honesty rules

The tools return a `caveats` array generated from the data — n = 1 warnings,
lopsided cohorts, mismatched window lengths, missing snapshots, clamped windows.
The skill is required to report them, so the limits of a result do not depend on
the model remembering to mention them. It must not extrapolate a monthly figure
from a single run pair, and leads with per-run and per-call rates whenever the two
sides differ in size.

### Files

```
assets/skills/ai-change-impact/
  SKILL.md                 The workflow: mode → scope → split point → gather → interpret → report
  references/
    interpretation.md      Attributing each driver to a cause, confidence thresholds, when to say "no difference"
```

---

## The loop, end to end

The two skills are worth more together than apart. A full cycle:

1. **Find it.** `/ai-usage-review` → *"Global CLAUDE.md is 3,180 tokens, ~$41/month.
   Do this first."*
2. **Apply it.** Accept the offer, or edit yourself. The app records a harness
   snapshot when the file changes, which becomes the split point later.
3. **Note the date.** The skill tells you; you do not have to remember it.
4. **Keep working** for long enough to have data on both sides — a few sessions,
   or a few days.
5. **Measure it.** *"did trimming CLAUDE.md help?"* → the skill finds the split
   point from `get_harness_changes`, compares the periods either side, and reports
   whether the tokens-per-call driver actually moved.

If step 5 says *no measurable difference*, that is a real answer: the estimate in
step 1 was wrong, or the change was too small to see against the noise. Both are
worth knowing before you make ten more edits on the same theory.

### Mind the retention window

Every recorded count — skill calls, hook fires, injected tokens, comparison
windows — spans the [retention window](../README.md#data-retention), 30 days by
default, not a fixed month. The "before" side of a comparison has to still be
inside it. If you plan to measure a change, make it early in the window rather
than late, and do not widen the window expecting deleted history back — widening
re-scans transcripts, so it only restores what the JSONL files still hold.
