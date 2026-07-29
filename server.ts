import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { mkdirSync } from "node:fs";
import { relative } from "node:path";
import { DATA_DIR, STATIC_DIR } from "./src/paths";
import { getDb } from "./src/db";
import { PROVIDERS } from "./src/providers";
import { startWatcher } from "./src/watcher";
import { getRetentionDays, startRetentionSweeper } from "./src/retention";
import { settingsRouter } from "./src/api/settingsEndpoints";
import { transcriptRouter } from "./src/api/transcriptEndpoints";
import { providersRouter } from "./src/api/providersEndpoint";
import { configRouter } from "./src/api/configEndpoints";
import { mcpRouter, mcpInfoRouter } from "./src/api/mcpEndpoint";
import { formatProvisionReport, provision } from "./src/provision";

const argv = Bun.argv.slice(2);
const PORT = parseInt(Bun.env["PORT"] ?? argv.find(a => a.startsWith("--port="))?.split("=")[1] ?? "5757", 10);
// Loopback by default: the config API can edit CLAUDE.md/commands/skills, so
// it must not be reachable from the LAN unless explicitly requested.
const HOST = Bun.env["HOST"] ?? argv.find(a => a.startsWith("--host="))?.split("=")[1] ?? "127.0.0.1";
const NO_BROWSER  = argv.includes("--no-browser");
const STATIC_ONLY = argv.includes("--static-only");
const NO_PROVISION = argv.includes("--no-provision");

mkdirSync(DATA_DIR, { recursive: true });

const db = getDb();
console.log("[startup] scanning transcript files…");
for (const provider of PROVIDERS) {
  if (!provider.hasData()) continue;
  console.log(`[startup] scanning provider: ${provider.id}`);
  provider.scanAll(db);
}
console.log("[startup] done scanning");

// Trim the cache to the configured window, then keep trimming as the cutoff
// moves past local midnight on a long-running server.
console.log(`[startup] data retention: ${getRetentionDays()} days`);
startRetentionSweeper(db);

if (!STATIC_ONLY) startWatcher(db);

// The MCP endpoint is always advertised on loopback, even when the server is
// bound to 0.0.0.0 — clients on this machine connect to themselves, and the
// registration written into each tool's config must not embed a LAN address.
const MCP_URL = `http://127.0.0.1:${PORT}/mcp`;

// Install the bundled usage-review skill and register this MCP endpoint with
// every AI tool detected on this machine. Idempotent, so it self-heals after a
// port change and stays silent once everything is in place.
// Deliberately not awaited: registering with a tool shells out to its CLI, and
// the dashboard should be serving before that finishes.
if (!NO_PROVISION) {
  void provision({ mcpUrl: MCP_URL })
    .then(reports => { for (const line of formatProvisionReport(reports)) console.log(line); })
    // Provisioning is a convenience — never let it stop the dashboard starting.
    .catch(e => console.warn(`[provision] skipped: ${e instanceof Error ? e.message : String(e)}`));
}

if (!NO_BROWSER && !STATIC_ONLY) {
  const url = `http://localhost:${PORT}`;
  // Pick the platform's opener; stderr is ignored so a missing one never crashes us.
  const openCmd =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  Bun.spawn(openCmd, { stderr: "ignore" });
}

const app = new Hono();

app.route("/api/settings",  settingsRouter);
app.route("/api/providers", providersRouter);
app.route("/api/config",    configRouter);
app.route("/api",           transcriptRouter);
app.route("/mcp",           mcpRouter);
app.route("/api/mcp-server", mcpInfoRouter);

// hono's serveStatic root is resolved against the CWD, so a bare "./static"
// 404s the whole UI whenever the app is started from anywhere but its own
// directory. Point it at the real static dir — as a CWD-RELATIVE path, because
// hono strips the leading "/" off an absolute root and would turn it back into
// a relative one on macOS/Linux. Separators are forward slashes for the same
// reason: hono builds the path by string concatenation, not path.join.
const STATIC_ROOT = (relative(process.cwd(), STATIC_DIR) || ".").replace(/\\/g, "/");
app.use("/*", serveStatic({ root: STATIC_ROOT }));

console.log(`AI Insights → http://localhost:${PORT}`);
console.log(`MCP server  → ${MCP_URL} (streamable HTTP, read-only)`);

export default { port: PORT, hostname: HOST, fetch: app.fetch };
