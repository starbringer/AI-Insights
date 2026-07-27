import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { mkdirSync } from "node:fs";
import { DATA_DIR } from "./src/paths";
import { getDb } from "./src/db";
import { PROVIDERS } from "./src/providers";
import { startWatcher } from "./src/watcher";
import { settingsRouter } from "./src/api/settingsEndpoints";
import { transcriptRouter } from "./src/api/transcriptEndpoints";
import { providersRouter } from "./src/api/providersEndpoint";
import { configRouter } from "./src/api/configEndpoints";

const argv = Bun.argv.slice(2);
const PORT = parseInt(Bun.env["PORT"] ?? argv.find(a => a.startsWith("--port="))?.split("=")[1] ?? "5757", 10);
// Loopback by default: the config API can edit CLAUDE.md/commands/skills, so
// it must not be reachable from the LAN unless explicitly requested.
const HOST = Bun.env["HOST"] ?? argv.find(a => a.startsWith("--host="))?.split("=")[1] ?? "127.0.0.1";
const NO_BROWSER  = argv.includes("--no-browser");
const STATIC_ONLY = argv.includes("--static-only");

mkdirSync(DATA_DIR, { recursive: true });

const db = getDb();
console.log("[startup] scanning transcript files…");
for (const provider of PROVIDERS) {
  if (!provider.hasData()) continue;
  console.log(`[startup] scanning provider: ${provider.id}`);
  provider.scanAll(db);
}
console.log("[startup] done scanning");

if (!STATIC_ONLY) startWatcher(db);

if (!NO_BROWSER && !STATIC_ONLY) {
  // Windows: use cmd /c start; fall back to explorer
  Bun.spawn(["cmd", "/c", `start http://localhost:${PORT}`], { stderr: "ignore" });
}

const app = new Hono();

app.route("/api/settings",  settingsRouter);
app.route("/api/providers", providersRouter);
app.route("/api/config",    configRouter);
app.route("/api",           transcriptRouter);

app.use("/*", serveStatic({ root: "./static" }));

console.log(`AI Insights → http://localhost:${PORT}`);

export default { port: PORT, hostname: HOST, fetch: app.fetch };
