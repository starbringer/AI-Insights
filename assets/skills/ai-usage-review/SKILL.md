---
name: ai-usage-review
description: Review recorded AI coding-tool usage and recommend concrete optimizations. Reads real token, cost, session and harness-configuration data from the AI Insights MCP server, then reports ranked, evidence-backed fixes — trimming instruction files, raising the prompt-cache hit rate, right-sizing models, cutting MCP overhead, turning repeated work into skills or commands, and repairing dead hooks, shadowed commands, thin permission allowlists and settings written to layers the tool never reads. Use when the user asks to review, audit or optimize their AI usage, wants to cut token spend or cost, asks why sessions are expensive, slow, or keep running out of context, asks how to structure CLAUDE.md / skills / hooks / MCP servers / subagents, or mentions AI Insights.
argument-hint: "[provider] [focus, e.g. cost, context, a project path, or a run id]"
allowed-tools: mcp__ai-insights Read Glob Grep
---

# AI usage review

Turn recorded usage into a small number of changes that are worth making.

Two rules govern the whole review:

- **Evidence before advice.** Every finding cites a number this session actually
  measured. No generic best-practice lists.
- **You never edit config as part of the review.** The MCP server is read-only by
  design. Report findings, then apply only what the user picks, using your normal
  edit tools so each change goes through their approval.

## 1. Establish scope

Ask nothing you can look up. Run `list_providers` first, then pick the provider:

- The user named one → use it.
- Exactly one has `hasData: true` → use it, say which.
- Several do → ask which, or use `provider: "all"` if they want the whole picture.

Pass that value as `provider` on **every** subsequent call. Default is Claude Code.

If the tools are missing, the dashboard is not running: tell the user to run
`bun run start` in the AI Insights directory, and stop.

## 2. Gather

Read `references/playbook.md` now — it holds the thresholds, the diagnosis rules
and the exact fix text for each finding. Then collect, in this order:

| Step | Tools | What you are looking for |
|---|---|---|
| Shape of spend | `get_usage_summary`, `get_model_usage`, `get_project_usage` | Scale, trend, model mix, where it lands |
| Waste signals | `get_usage_timeseries`, `get_top_runs`, `get_top_turns` | Spikes, cache collapse, outlier calls |
| Per-session detail | `get_run_usage` on the top 2–3 runs | Bucket split (base/MCP/skills/sub-agents) and its built-in advice |
| Always-on context | `list_instruction_files`, then `read_instruction_file` on the largest | Per-turn tax paid on every single call |
| Extension ROI | `list_skills`, `get_skill_usage`, `list_commands`, `list_mcp_servers`, `get_mcp_usage` | Cost carried vs. value returned |
| Determinism gaps | `list_hooks`, `get_dependency_graph` | Rules that should be hooks; hooks that never fire |
| Correctness | `get_effective_config`, `get_permissions`, `list_memory_stores` | Ignored layers, thin allowlists, orphaned memory |

Stop gathering once you can support your findings. A review that reads
everything is itself an example of the waste you are diagnosing.

**Know your horizon.** The app keeps a rolling window of records (default 30
days, user-configurable) and deletes everything older, so the window is the hard
limit on what any tool can tell you. `get_usage_summary` reports it as
`retentionDays`; `get_data_retention` gives it on its own. Every recorded count —
skill `calls`, hook `fires`, MCP usage, injected-token estimates — spans that
window, not a fixed month. Say the real span in your findings ("14 calls in the
last 7 days"), and when you extrapolate to a monthly saving, scale from the
window's actual width instead of assuming 30 days.

## 3. Diagnose

Work through the checks in `references/playbook.md`. For each one that fires,
record: the measurement, the threshold it crossed, the fix, and an **estimated
monthly token or dollar saving** derived from the numbers you read — never from
a percentage you invented.

Where the user has named a specific problem ("I keep running out of context",
"it keeps asking permission", "it ignores my rules"), lead with the checks that
explain that symptom; the playbook maps symptoms to checks.

## 4. Report

Order findings by estimated saving, largest first. Cap at 7 — a list nobody acts
on saves nothing. Use this shape per finding:

```
### <Finding> — ~<saving>/month
**Measured:** <the numbers, with the tool they came from>
**Why it costs:** <one sentence>
**Fix:** <the specific change, naming files and values>
**Effort:** <one-line edit | 10 minutes | a session>
```

Close with a **Do this first** line naming the single highest ratio of saving to
effort, and a one-line note of what you checked that was already healthy — the
user needs to know the absence of a finding was measured, not skipped.

When the request is about how to *structure* something rather than what to cut
(CLAUDE.md layout, whether a thing should be a skill or a hook, how to write a
skill description that actually triggers), read `references/authoring.md` and
answer from it, still anchored to what this user's config actually looks like.

## 5. Offer to apply

List the findings that are mechanical (trimming an instruction file, deleting a
dead hook, adding an allowlist entry) and offer to apply them. On acceptance,
make each change with your own edit tools, one at a time, showing the diff.

Re-run the relevant tool afterwards to confirm the numbers moved.

Then tell the user how to check the estimate against reality: the
`ai-change-impact` skill compares recorded usage before and after a change and
reports what it actually saved. Note the date, so the split point is known.
