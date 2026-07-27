import { claudeCodeProvider } from "./claude-code";
import { pathKey } from "../paths";
import type { Provider, ProviderInfo } from "./types";

export type { Provider, ProviderInfo, NormalizedTurn } from "./types";

/**
 * Registry of all known providers. Adding a new source (Gemini, ChatGPT,
 * Ollama, …) means dropping its module under src/providers/<id>/ and
 * appending its exported provider object here.
 */
export const PROVIDERS: Provider[] = [
  claudeCodeProvider,
];

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    description: p.description,
    dataDir: p.dataDir,
    hasData: p.hasData(),
  }));
}

/**
 * Find the provider that owns a given file path (used by the watcher).
 *
 * Case-folded on Windows only: the watcher's paths come back from chokidar,
 * which may realpath the watch root and hand back different casing than
 * `homedir()` produced (`C:\users\me` vs `C:\Users\me`) — that would drop every
 * event. On case-sensitive filesystems folding would instead merge genuinely
 * distinct directories, so it stays verbatim there.
 */
export function providerForPath(path: string): Provider | null {
  const target = pathKey(path);
  for (const p of PROVIDERS) {
    if (target.startsWith(pathKey(p.dataDir)) && p.fileMatches(path)) return p;
  }
  return null;
}

/** Find a provider by id. */
export function providerById(id: string): Provider | null {
  return PROVIDERS.find(p => p.id === id) ?? null;
}
