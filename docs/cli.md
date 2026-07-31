# Running the server

**English** | [简体中文](cli.zh-CN.md)

`bun run start` needs no arguments. The flags below change where it listens and
what it does on startup.

---

## Command-line options

```bash
bun run server.ts --port=8080 --no-browser
```

| Flag | Description |
|------|-------------|
| `--port=N` | Listen on port N (default: `5757`) |
| `--host=H` | Bind address (default: `127.0.0.1`) — the config API can edit files, so it stays loopback-only unless you opt in to `0.0.0.0`. [Why](architecture.md#network-binding) |
| `--no-browser` | Don't auto-open the browser |
| `--static-only` | Skip the file watcher (and the browser) — the startup scan still runs, but later changes need a restart |
| `--no-provision` | Don't install the skills or register the MCP server with your AI tools. `/mcp` is still served — [details](mcp.md#opting-out) |

The environment variables `PORT` and `HOST` do the same, and win over the flags.

## Scripts

| Script | Does |
|---|---|
| `bun run start` | Server + MCP endpoint (same as `bun run server.ts`) |
| `bun run dev` | Hot-reload with `--watch` |
| `bun run mcp` | MCP server over stdio, for clients that can't use HTTP |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit test suite |
| `bun run build` | Standalone binary for the current platform |
| `bun run build:mcp` | Standalone binary of the stdio MCP server |

## Standalone executable

```bash
bun run build   # → dist/ai-insights (.exe on Windows), ~60MB, no Bun install needed
```

- Ship `static/` and `assets/` alongside the binary — all three plus the `data/` cache resolve next to the executable, so it launches from any working directory.
- Without `assets/`, everything works except installing the bundled skills.
- Cross-compile with a target: `bun build --compile --target=bun-<windows|darwin|linux>-x64 server.ts --outfile dist/ai-insights` (`bun-darwin-arm64` for Apple Silicon).
