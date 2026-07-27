# Screenshots

Every page of the app, captured at 1500×980 (2× device pixel ratio).

**All data shown is pseudonymized.** The capture harness intercepts every `/api/*`
response before the UI renders it and replaces personal content with realistic
stand-ins, so nothing here reveals real projects or conversations:

| Sensitive value | Shown as |
|---|---|
| Project directories (`X:\...\my-project`) | `C:\dev\acme-web`, `C:\dev\api-service`, … |
| Home directory / OS username | `C:\Users\dev` |
| Run titles | Neutral engineering titles ("Refactor the settings module") |
| Prompt, output, thinking and tool-result text | Generated filler of the same shape and length |
| Skill / command / MCP server / MCP tool names | `code-reviewer`, `deploy`, `weather`, `weather_op_3`, … |
| Hook script filenames | `format-on-save.ps1`, `notify-done.ps1`, … |
| Memory topics and their content | `build-pipeline-notes`, filler body text |
| Permission rule specifiers | `Bash(npm run build:*)`, `Read(src/**)`, … |
| Workflow chain names | `research`, `release`, … |
| Leftover absolute paths, emails | `C:\dev\workspace\file.ext`, `dev@example.com` |

Mapping is deterministic (the same real value always becomes the same stand-in),
so cross-references — a skill named in a workflow graph, a project in both the
Runs table and a chart — stay consistent across pages.

Token counts, costs, timestamps, model names and all structural metadata are real.

| File | Page |
|---|---|
| `01-dashboard.png` | Dashboard — KPI cards and token trend |
| `02-dashboard-charts.png` | Dashboard — model / project / MCP / skill usage, cache hit rate, model mix, top runs |
| `03-runs.png` | Runs list |
| `04-run-detail-tree.png` | Run detail — session tree (Tree view) |
| `05-run-detail-usage.png` | Run detail — cost breakdown (Usage view) |
| `06-claudemd.png` | CLAUDE.md — instruction files, injection timeline, editor |
| `07-commands.png` | Commands — slash commands across user / project / plugin sources |
| `08-skills.png` | Skills — list + detail with trigger analysis and editor |
| `09-hooks.png` | Hooks — entries across settings layers with recorded fire counts |
| `10-hooks-script.png` | Hooks — hook script viewer / editor |
| `11-mcp.png` | MCP — servers, probe status, tools and schema token cost |
| `12-permissions.png` | Permissions — allow/deny/ask rules with layer overrides |
| `13-memory.png` | Memory — per-project memory stores |
| `14-workflow.png` | Workflow — detected chain and its dependency graph |
| `15-configs.png` | Effective Configs — merged settings layers |
| `16-settings.png` | Settings — thresholds and pricing |
| `17-dashboard-dark.png` | Dashboard in the dark theme |
