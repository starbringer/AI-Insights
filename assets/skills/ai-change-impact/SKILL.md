---
name: ai-change-impact
description: Measure what a change to an AI coding setup actually saved, in dollars. Compares recorded before/after usage from the AI Insights MCP server — either two specific sessions by id, or everything in one period against another — and attributes the cost difference to the factor that moved it: fewer API calls, less context per call, or a cheaper model/cache blend. Use when the user has edited a CLAUDE.md, skill, MCP server, hook, subagent, model choice or workflow and asks whether it helped, how much it saved, whether it was worth it, or wants two runs or two time periods compared. Also use for "is my setup cheaper than last week", "did trimming CLAUDE.md work", "prove this change paid off", or when verifying a fix suggested by an earlier usage review.
argument-hint: "[two run ids, or a date/period to split on] [provider]"
allowed-tools: mcp__ai-insights Read Glob Grep
---

# AI change impact

Answer one question: **did that change save money, and how much?**

Three rules govern the whole analysis:

- **The arithmetic is the app's job, the judgement is yours.** `compare_runs` and
  `compare_periods` return an exact decomposition. Your value is deciding whether
  the comparison is fair and saying so plainly.
- **Report the caveats.** Both tools return a `caveats` array generated from the
  actual data. Never drop it. A saving the user cannot rely on is worse than no
  number, because they will act on it.
- **You never edit config here.** This skill measures. If the answer is "it got
  worse", say that and stop; fixing it is a separate request.

## 1. Pick the mode

| The user has… | Mode | Tool |
|---|---|---|
| Two runs to compare (re-ran the same task) | Run vs run | `compare_runs` |
| Just kept working after the change | Period vs period | `compare_periods` |
| A change but no idea when | Find the split first | `get_harness_changes` |

Run mode is exact but n = 1. Period mode is noisier but reflects real use. When
both are possible, do **both**: they answer different questions, and agreement
between them is the strongest evidence you can offer.

## 2. Establish scope and horizon

Run `list_providers`, then pick the provider: the one the user named, the only one
with `hasData: true`, or ask. Pass it as `provider` on **every** call — a harness
diff needs a concrete provider and is skipped for `"all"`.

Then check `get_data_retention` **before** asking for any window. Records older
than `retentionDays` are deleted, not hidden. If the "before" side predates
`oldestRetainedTimestamp`, say so directly:

> Your retention is set to 30 days, so nothing before 2026-06-29 exists any more —
> that period cannot be compared. Raise the retention setting now if you want this
> question answerable next month; the data cannot be recovered once deleted.

Do not fall back to a window you can answer and present it as the answer.

## 3. Find the split point

If the user did not give a date, call `get_harness_changes` and offer what it
found rather than asking them to remember:

> Your CLAUDE.md dropped 1,740 tokens on Jul 22 at 14:05, and the `deep-review`
> skill was removed the same day. Compare the week either side of that?

`changePoints: 0` means either nothing changed or the edit predates the snapshot
log (it starts when the app first ran). Say which you think it is; do not report
"nothing changed" as if it were measured.

## 4. Gather

Run mode — get the ids first if the user gave a description rather than an id:

1. `list_runs` (with `search` or `project`) → note each row's `run_key`.
2. `compare_runs` with the two keys. Order does not matter; the earlier run is
   always the baseline.

Period mode:

1. `compare_periods` with `before: {from, until}` and `after: {from, until}`.
   Windows are half-open, so use the same timestamp as one window's `until` and
   the next's `from` — they will not double count.
2. Keep the two windows the **same length**, or the totals are meaningless. The
   tool warns you when they are not.
3. Add `project` when the change was project-scoped; a global CLAUDE.md edit
   should be compared unscoped.

That is usually enough. Reach for `get_run_usage` on a named run only when a
driver needs unpacking, and read `references/interpretation.md` before writing
the report — it holds the attribution rules and the confidence thresholds.

## 5. Interpret

The `drivers` array splits the cost delta into three terms that **sum exactly**
to it:

| Driver | Means | Typically caused by |
|---|---|---|
| `volume` | more/fewer API calls | a workflow, hook or subagent change; a task that just needed less work |
| `tokens-per-turn` | each call carried more/less context | instruction files, MCP schemas, skill bodies, tool-result size |
| `price-per-token` | the model/cache blend repriced | a model switch, or cache hits rising/collapsing |

Read `priceEvidence` before attributing the third one — model mix and cache rate
both land there and are entangled, so name whichever actually moved rather than
guessing.

Cross-check the driver against `harnessDiff`. A `tokens-per-turn` saving next to a
CLAUDE.md that shrank is a real causal story. A `volume` saving next to an
unchanged harness is probably just an easier task, and you should say so.

## 6. Report

```
## <Change> — <saved $X (Y%) | cost $X more (Y%) | no measurable difference>

**Measured:** <before → after, with the window or run ids>
**What moved it:** <the dominant driver, in the user's terms, with its dollar figure>
**Cross-check:** <what harnessDiff shows, or that no snapshot covers it>
**Confidence:** <high | moderate | low> — <the reason, from caveats>
**Extrapolated:** <only if the sample supports it — state the assumption>
```

Then a short evidence table of the metrics that moved: cost, cost per run, cost
per API call, tokens per call, cache hit rate, bucket split.

Rules for the number you put in the headline:

- **No monthly figure from a single run pair.** Say "on this pair" and stop.
- **Lead with rates, not totals, whenever the two sides differ in size** — a quiet
  week looks identical to a real improvement in a total.
- **Report regressions just as plainly as wins.** The user asked a question, not
  for reassurance.
- **A delta smaller than the noise is "no measurable difference"**, not a small
  win. `references/interpretation.md` has the thresholds.

Close with one line on what to do next: keep the change, revert it, or gather
more runs before deciding.

## 7. Verifying an earlier review

When this follows a fix that `ai-usage-review` recommended, quote its original
estimate against the measured result — "estimated ~$40/month, measured $34/month
across 9 runs". That closes the loop and calibrates the next estimate.
