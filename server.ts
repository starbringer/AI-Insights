import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { mkdirSync } from "node:fs";
import { DATA_DIR } from "./src/paths";
import { getDb } from "./src/db";
import { scanAll } from "./src/transcripts/parser";
import { startWatcher } from "./src/watcher";
import { auditRouter } from "./src/api/auditEndpoints";
import { transcriptRouter } from "./src/api/transcriptEndpoints";

const argv = Bun.argv.slice(2);
const PORT = parseInt(Bun.env["PORT"] ?? argv.find(a => a.startsWith("--port="))?.split("=")[1] ?? "5757", 10);
const NO_BROWSER  = argv.includes("--no-browser");
const STATIC_ONLY = argv.includes("--static-only");

mkdirSync(DATA_DIR, { recursive: true });

const db = getDb();
console.log("[startup] scanning JSONL files…");
scanAll(db);
console.log("[startup] done scanning");

if (!STATIC_ONLY) startWatcher(db);

if (!NO_BROWSER && !STATIC_ONLY) {
  // Windows: use cmd /c start; fall back to explorer
  Bun.spawn(["cmd", "/c", `start http://localhost:${PORT}`], { stderr: "ignore" });
}

const app = new Hono();

app.route("/api/audit", auditRouter);
app.route("/api",       transcriptRouter);

app.use("/*", serveStatic({ root: "./static" }));

console.log(`LLM Usage Monitor → http://localhost:${PORT}`);

export default { port: PORT, fetch: app.fetch };
