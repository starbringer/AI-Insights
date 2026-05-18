import chokidar from "chokidar";
import type { Database } from "bun:sqlite";
import { parseFileIncremental } from "./transcripts/parser";
import { PROJECTS_DIR } from "./paths";

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function startWatcher(db: Database): void {
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
    persistent: true,
    depth: 10,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher.on("change", (path: string) => {
    if (!path.endsWith(".jsonl")) return;

    const existing = debounceTimers.get(path);
    if (existing) clearTimeout(existing);

    debounceTimers.set(path, setTimeout(() => {
      debounceTimers.delete(path);
      handleChange(db, path);
    }, 200));
  });

  watcher.on("add", (path: string) => {
    if (!path.endsWith(".jsonl")) return;
    handleChange(db, path);
  });

  watcher.on("error", (err: unknown) => {
    console.error("[watcher] error:", err);
  });

  console.log(`[watcher] watching ${PROJECTS_DIR}`);
}

function handleChange(db: Database, filePath: string): void {
  const normalized = filePath.replace(/\//g, "\\");
  const isSubagent = normalized.includes("\\subagents\\");
  let parentSessionId: string | null = null;

  if (isSubagent) {
    const parts = normalized.split("\\");
    const idx = parts.lastIndexOf("subagents");
    if (idx > 0) parentSessionId = parts[idx - 1] ?? null;
  }

  parseFileIncremental(db, normalized, isSubagent, parentSessionId);
}
