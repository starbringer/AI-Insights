import chokidar from "chokidar";
import type { Database } from "bun:sqlite";
import { PROVIDERS, providerForPath } from "./providers";

let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function startWatcher(db: Database): void {
  for (const provider of PROVIDERS) {
    const watcher = chokidar.watch(provider.dataDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on("change", (path: string) => {
      if (!provider.fileMatches(path)) return;

      const existing = debounceTimers.get(path);
      if (existing) clearTimeout(existing);

      debounceTimers.set(path, setTimeout(() => {
        debounceTimers.delete(path);
        handleChange(db, path);
      }, 200));
    });

    watcher.on("add", (path: string) => {
      if (!provider.fileMatches(path)) return;
      handleChange(db, path);
    });

    watcher.on("error", (err: unknown) => {
      console.error(`[watcher:${provider.id}] error:`, err);
    });

    console.log(`[watcher] watching ${provider.dataDir} (${provider.id})`);
  }
}

function handleChange(db: Database, filePath: string): void {
  const provider = providerForPath(filePath);
  if (!provider) return;
  provider.ingestFile(db, filePath);
}
