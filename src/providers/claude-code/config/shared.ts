import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CLAUDE_DIR, SETTINGS_PATH } from "../../../paths";

const PROVIDER_ID = "claude-code";

/** Case-fold path keys on Windows so differently-cased duplicates collapse. */
export function pathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Projects this tool has actually touched — distinct cwd of recorded agents.
 * Data-driven (from transcripts), no directory guessing like cc-harness's
 * hardcoded scan roots.
 */
export function listProjectDirs(db: Database): string[] {
  const rows = db.query<{ cwd: string }, [string]>(
    `SELECT DISTINCT cwd FROM agents WHERE provider = ? AND cwd IS NOT NULL ORDER BY cwd`
  ).all(PROVIDER_ID);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = pathKey(r.cwd);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.cwd);
  }
  return out;
}

/**
 * Minimal YAML-ish frontmatter parser: flat `key: value` lines, CRLF-tolerant,
 * plus block scalars (`key: >` / `key: |`) folded from the indented lines that
 * follow — skills commonly write multi-line descriptions that way.
 */
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  const lines = m[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s/.test(line)) continue; // continuation lines are consumed below
    const ci = line.indexOf(":");
    if (ci <= 0) continue;
    const key = line.slice(0, ci).trim();
    let value = line.slice(ci + 1).trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || lines[i + 1] === "")) {
        block.push(lines[++i]!.trim());
      }
      value = block.join(value.startsWith("|") ? "\n" : " ").trim();
    }
    meta[key] = value;
  }
  return { meta, body: content.slice(m[0].length) };
}

export interface InstalledPlugin {
  pluginName: string;
  marketplace: string;
  scope: "user" | "project";
  version: string;
  installPath: string;
}

/**
 * ~/.claude/plugins/installed_plugins.json is the source of truth for which
 * plugin versions are active (the cache dir can hold stale versions).
 */
export function readInstalledPlugins(): InstalledPlugin[] {
  const file = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
  if (!existsSync(file)) return [];
  let data: { plugins?: Record<string, { scope?: string; version?: string; installPath?: string }[]> };
  try { data = JSON.parse(readFileSync(file, "utf-8")); } catch { return []; }
  const out: InstalledPlugin[] = [];
  for (const [key, entries] of Object.entries(data.plugins ?? {})) {
    const at = key.lastIndexOf("@");
    const pluginName = at >= 0 ? key.slice(0, at) : key;
    const marketplace = at >= 0 ? key.slice(at + 1) : "";
    for (const e of entries ?? []) {
      if (!e.installPath || !e.version) continue;
      out.push({
        pluginName, marketplace, version: e.version, installPath: e.installPath,
        scope: e.scope === "project" ? "project" : "user",
      });
    }
  }
  return out;
}

/** enabledPlugins from settings.json — value false means explicitly disabled. */
export function readEnabledPlugins(): Record<string, unknown> {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as { enabledPlugins?: Record<string, unknown> };
    return s.enabledPlugins ?? {};
  } catch { return {}; }
}

export function enabledPluginDirs(subdir: string): { dir: string; plugin: InstalledPlugin }[] {
  const enabled = readEnabledPlugins();
  const out: { dir: string; plugin: InstalledPlugin }[] = [];
  for (const pl of readInstalledPlugins()) {
    if (enabled[`${pl.pluginName}@${pl.marketplace}`] === false) continue;
    out.push({ dir: join(pl.installPath, subdir), plugin: pl });
  }
  return out;
}

function semverKey(v?: string): string {
  return (v ?? "0").split(".").map(n => String(parseInt(n, 10) || 0).padStart(6, "0")).join(".");
}

export interface Overridable {
  name: string;
  source: "user" | "project" | "plugin";
  pluginScope?: "user" | "project";
  pluginName?: string;
  marketplace?: string;
  version?: string;
  overriddenBy?: string;
}

export function sourceUid(x: Overridable): string {
  return x.source === "plugin"
    ? `plugin:${x.marketplace}/${x.pluginName}@${x.version}/${x.name}`
    : `${x.source}:${x.name}`;
}

/**
 * Same-name override detection across the three source tiers:
 * user > project > plugin; among plugins, user-scope > project-scope, then
 * the higher version wins. Losers get overriddenBy = winner's uid (kept in
 * the list so the UI can grey them out).
 */
export function markOverrides<T extends Overridable>(items: T[]): void {
  const rank = (s: T): [number, number, string] => [
    s.source === "user" ? 3 : s.source === "project" ? 2 : 1,
    s.pluginScope === "user" ? 1 : 0,
    semverKey(s.version),
  ];
  const gt = (a: T, b: T): boolean => {
    const ta = rank(a), tb = rank(b);
    for (let i = 0; i < 3; i++) if (ta[i] !== tb[i]) return ta[i]! > tb[i]!;
    return false;
  };
  const byName = new Map<string, T[]>();
  for (const it of items) {
    const g = byName.get(it.name);
    if (g) g.push(it); else byName.set(it.name, [it]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const winner = group.reduce((a, b) => (gt(b, a) ? b : a));
    for (const it of group) if (it !== winner) it.overriddenBy = sourceUid(winner);
  }
}

/** Read + parse a JSON file; null when missing or invalid. */
export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return null; }
}
