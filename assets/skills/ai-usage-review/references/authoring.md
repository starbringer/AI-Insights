# Authoring reference

How to build the thing a finding asks for. Read this when the answer is "write a
skill / hook / command / sub-agent" rather than "delete something".

## Choosing the mechanism

Pick by *when the content is needed* and *how strongly it must hold*.

| Need | Mechanism | Token cost | Guaranteed? |
|---|---|---|---|
| A fact true in every session | Instruction file (CLAUDE.md) | Every request, all session | No — advisory |
| A procedure needed sometimes | Skill | Only once invoked | No — advisory |
| A user-triggered workflow | Skill with `disable-model-invocation: true` | Only when you type `/name` | n/a |
| Something that must happen every time | Hook | Zero | **Yes** — deterministic |
| Read-heavy work that pollutes context | Sub-agent | Isolated context, summary returns | n/a |
| Access to an external system | MCP server, or a CLI if one exists | Per call | n/a |

Two rules that resolve most cases:

- **If it must happen every time, it is a hook.** Prose in an instruction file is
  followed most of the time; that is not the same thing.
- **If it is only sometimes relevant, it is a skill.** Instruction files pay for
  their content on every request of every session, including the ones where the
  content is irrelevant.

## Instruction files (CLAUDE.md)

Target: under ~200 lines. Every line is re-read on every request.

```markdown
# Commands
- Test: `bun test` (not npm — this repo uses Bun)
- Typecheck: `bun run typecheck` after any type change

# Style
- ES modules only; no CommonJS
- Errors: return typed results, never throw across module boundaries

# Etiquette
- Branch from `main`, name `feat/<slug>`
- Never commit without running the typecheck above
```

Include: commands that can't be guessed, style rules that differ from the
language default, repo etiquette, environment quirks, project-specific
architecture decisions.

Exclude: anything derivable by reading the code, standard language conventions,
API docs (link instead), file-by-file descriptions, generic advice, anything that
changes often.

Emphasis (`IMPORTANT`, `YOU MUST`) improves adherence — but if you need it on
many lines, the file is too long and rules are being lost. Prune first.

Split by scope: home-directory file for cross-project preferences, project file
(committed) for team rules, a git-ignored local file for personal overrides.

## Skills

```markdown
---
name: migrate-endpoint
description: Migrate a REST endpoint to the v2 handler pattern. Use when the user asks to migrate, port or upgrade an endpoint, or mentions the v2 handler layout.
argument-hint: "[endpoint path]"
disable-model-invocation: true
---

Migrate $ARGUMENTS to the v2 handler pattern.

1. Read the target handler and its test.
2. Apply the v2 shape from `references/v2-pattern.md`.
3. Run `bun test <path>` and fix failures.
4. Show the diff; do not commit.
```

**The description is the whole triggering mechanism.** It is the only part the
model sees when deciding whether to load the skill. Write it as *what it does +
when to use it*, put the primary use case first, and include the words a user
would actually type. "Helps with API stuff" never fires; the example above does.

**Keep the body short.** Once loaded it stays in context for the rest of the
turn. State what to do, not why. Move long reference material into
`references/*.md` and tell the skill to read them only when needed — that is the
whole point of the directory layout:

```
my-skill/
  SKILL.md            short: workflow and decision rules
  references/         long: loaded on demand, free until read
  scripts/            executable helpers, cheaper than describing the steps
```

Frontmatter worth knowing:

| Field | Use for |
|---|---|
| `description` | Triggering. The one field that matters most |
| `disable-model-invocation: true` | Side effects you want to trigger yourself (`/deploy`, `/commit`) |
| `user-invocable: false` | Background knowledge that isn't a meaningful command |
| `allowed-tools` | Pre-approve the tools the skill needs, to avoid prompts mid-run |
| `argument-hint` / `$ARGUMENTS` | Parameterized workflows |
| `model` / `effort` | Run a mechanical skill on a cheaper model |
| `context: fork` | Run the skill in its own sub-agent context |

## Hooks

Hooks are scripts the harness runs at fixed points. They cost no tokens and
cannot be skipped.

Three high-value patterns:

1. **Enforce a rule** — a `PreToolUse` hook that blocks writes to a protected
   path does what a paragraph of "never edit migrations" could not.
2. **Shrink output** — a `PreToolUse` hook on the test command that filters to
   failures turns a 10,000-line log into a few hundred tokens. This is usually
   the single biggest per-turn context win available.
3. **Close the loop** — a `Stop` hook that runs the test suite and blocks the
   turn from ending until it passes converts "looks done" into "verified".

When proposing one, give the event, the matcher, and the exact command, and note
which settings file it goes in. Check the existing `list_hooks` output first so
you don't propose a duplicate of something that already exists but never matches.

## Sub-agents

Use one when a task will read a lot and return a little: codebase investigation,
log analysis, dependency archaeology, adversarial review of a diff.

```markdown
---
name: log-triage
description: Triage a failing log and report the root cause
tools: Read, Grep, Glob, Bash
model: haiku
---
Find the first real error, trace it to its cause, and report the file, line and
a one-paragraph explanation. Do not fix anything.
```

Two details that matter for cost: pick the **cheapest model that can do the job**
(mechanical search does not need a premium model), and keep the spawn prompt
short — sub-agents load the instruction files and skill listings on their own, so
everything in the prompt is on top of that.

A reviewer sub-agent given a fresh context is also a quality mechanism: it did
not write the code, so it is not biased toward it.

## MCP servers vs CLIs

Prefer a CLI when one exists for the job. A CLI adds no per-tool listing
overhead, returns exactly the fields asked for, and can be piped and filtered
before the output reaches the model. Reach for an MCP server when there is no
CLI, when auth is easier to hold in the server, or when the tool needs to be
callable without shell access.

If a server stays, keep it narrow: fewer tools, tighter schemas, and calls that
request only the fields needed.

## Verification

Recommendations that change behaviour should come with a way to tell whether
they worked. Prefer, in order: a test the harness can run, a command with an exit
code, a diff against a fixture. Re-running the matching AI Insights tool after a
change is the direct check for a cost finding — the numbers move or they don't.
