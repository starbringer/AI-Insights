# Interpreting a comparison

The tools give you exact arithmetic. This file is about the part arithmetic cannot
settle: whether the comparison is fair, which cause explains it, and how much
confidence the number deserves.

## The decomposition

With `N` = API calls, `t` = tokens per call and `p` = cost per token, cost is
`N · t · p`, and the difference between two sides factors into three terms:

```
ΔC = (Nₐ − N_b) · t_b · p_b      volume
   +  Nₐ · (tₐ − t_b) · p_b      tokens-per-turn
   +  Nₐ · tₐ · (pₐ − p_b)       price-per-token
```

The three sum to ΔC exactly. Nothing is modelled or assumed, so you can quote any
single term as a real dollar figure. What you cannot do is claim the term *proves*
a cause — that is what `harnessDiff` is for.

## Attributing each driver

### `tokens-per-turn` dominates

Each API call carried a different amount of context. Ranked by how often this is
the real cause:

| Look at | Confirms |
|---|---|
| `harnessDiff` entries of type `instructions` | A CLAUDE.md / AGENTS.md edit — the cleanest possible story |
| `harnessDiff` entries of type `mcp` with a `schemaTokens` delta | An MCP server added, removed, or its tool surface changed |
| `components.mcpServers` / `components.skills` (run mode) | Fewer or cheaper tool calls injecting less payload |
| `byBucket` shifting out of `mcp` or `skills` | Work moved off an expensive extension |
| `components.tools` with a large `estTokens` on one tool | A tool returning huge results — often the real culprit behind "context is full" |

An instruction-file saving compounds with session length: the file sits in the
prefix of every request, so the same edit saves more in a long session than a
short one. If the two sides differ a lot in turn count, say the saving is
per-call and let the user scale it.

### `volume` dominates

Fewer or more API calls. Be careful here — this is the term most often *not* caused
by the change:

- `harnessDiff` shows a hook, subagent, command or skill change → plausible cause.
- `harnessDiff` shows nothing relevant → almost certainly task difficulty. Say so.
- `subagentCount` differs (run mode) → one run delegated and the other did not,
  which changes call count enormously. Not a fair pair.
- Run mode with very different `durationMinutes` → one session was probably
  interrupted or abandoned. Check before reporting.

### `price-per-token` dominates

The blended price moved. Read `priceEvidence` and name which of the two:

- `modelSharesBefore` vs `modelSharesAfter` differ → a model switch.
  `afterAtBeforeModelUsd` gives the exact counterfactual: what the after side's
  real tokens would have cost at the before side's dominant model.
- `cacheHitRatePctBefore` vs `...After` differ → cache behaviour. Cache reads are
  priced at a tenth of fresh input, so this term moves fast. A large drop usually
  means something now changes early in the prompt on every request — an
  instruction file edited mid-session, a rotating timestamp, or a reordered tool
  list.

Do not split this term between model and cache yourself. They are entangled: a
model switch changes what is cacheable. Name the one that visibly moved.

## Confidence

Set the report's confidence from the data, not from how good the number looks.

| Confidence | Requires |
|---|---|
| **High** | Period mode, ≥10 runs each side, equal-length windows, same project, `harnessDiff` names a change consistent with the dominant driver |
| **Moderate** | Period mode with 3–9 runs a side, or a run pair with similar turn counts, same project, and a matching `harnessDiff` |
| **Low** | A single run pair, fewer than 3 runs on a side, mismatched window lengths, different projects, or no snapshot covering the period |

Anything the `caveats` array raises drops confidence by at least one level. That
array is generated from the data, so it is never wrong about what it reports.

## When to say "no measurable difference"

Do not dress up noise as a win. Treat the result as no difference when:

- The cost delta is under **5%** and either side has fewer than 5 runs.
- The delta is under **10%** on a single run pair.
- The dominant driver is `volume` and `harnessDiff` shows no relevant change.
- Either side has 0 API calls — that is missing data, not a 100% saving.

Saying "this is within the noise, I'd want ~10 more runs before calling it"
is a genuinely useful answer, and it is the honest one.

## Extrapolating to a monthly figure

Only from period mode, and only stated as an assumption:

```
monthly = (after.costUsd / after_window_days) × 30
saving  = (before.costPerRun − after.costPerRun) × runs_per_month
```

Prefer the second form: it scales the per-run improvement by the user's actual run
rate, so a quiet week does not deflate the estimate. Derive `runs_per_month` from
`get_daily_usage` or `get_usage_summary` rather than from the comparison window
alone, and always name it: "at your recent rate of ~40 runs/month".

Never extrapolate from a single run pair. State the per-task saving and let the
user multiply by a number they trust.

## Reading the harness diff

`harnessDiff.changes` is ordered by absolute token movement, so the first entry is
usually the story. Fields worth quoting:

- `change`: `added` / `removed` / `modified`
- `tokensBefore` → `tokensAfter`, and `tokensDelta`
- `type`: `instructions`, `skill`, `command`, `hook`, `mcp`, `permissions`, `settings`

`exact: false` means one side fell back to the oldest snapshot on record, so the
diff is approximate — mention it. `changes: []` with snapshots present is a real
finding: the configuration genuinely did not change, so whatever moved the cost
was the work itself.

`tokensDelta: null` is normal for hooks, permissions and settings — they have no
token size. Their effect shows up in `volume`, not `tokens-per-turn`.
