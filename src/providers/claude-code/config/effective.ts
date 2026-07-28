import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { SETTINGS_PATH } from "../../../paths";
import type { ConfigLayerInfo, ConfigScope, EffectiveConfigEntry, EffectiveConfigModel } from "../../../config/types";
import { listProjectDirs, pathKey, shadowsUserConfig } from "./shared";

const LEVEL_ORDER: Record<string, number> = { user: 1, project: 2, local: 3 };

/**
 * Leaf keys Claude Code ACCUMULATES across layers rather than overriding —
 * every layer's rules stay in force. Treating the top layer as the sole winner
 * reported a two-rule project allowlist as killing a 59-rule user allowlist,
 * when all 61 rules were live. Sibling keys (permissions.defaultMode, …) do
 * override normally.
 */
const CONCAT_LEAF_KEYS = new Set(["permissions.allow", "permissions.deny", "permissions.ask"]);
const CONCAT_PARENT_KEYS = new Set(["permissions"]);

/**
 * Keys Claude Code (≥2.1.207) only reads from specific layers — writing them
 * elsewhere silently does nothing. A top-level hit covers the whole subtree.
 *   autoMode       → user layer only (repos must not make trust decisions)
 *   pluginConfigs  → user layer only
 */
const KEY_LEVEL_RESTRICTIONS: Record<string, ConfigScope[]> = {
  autoMode: ["user"],
  pluginConfigs: ["user"],
};

function levelHonored(keyPath: string, level: ConfigScope): boolean {
  const top = keyPath.split(".")[0]!;
  const allowed = Object.prototype.hasOwnProperty.call(KEY_LEVEL_RESTRICTIONS, top)
    ? KEY_LEVEL_RESTRICTIONS[top] : undefined;
  return !allowed || allowed.includes(level);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readLayer(filePath: string, level: ConfigScope): ConfigLayerInfo {
  let raw: Record<string, unknown> = {};
  let exists = false;
  let parseError: string | undefined;
  if (existsSync(filePath)) {
    exists = true;
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      if (isPlainObject(parsed)) raw = parsed;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }
  return { level, filePath, exists, parseError, raw };
}

interface PathMap { level: ConfigScope; paths: Map<string, unknown> }

/** Every layer's entries for an accumulated leaf key, lowest priority first. */
function concatLeaf(parts: PathMap[], key: string): unknown[] {
  const out: unknown[] = [];
  for (const pm of parts) {
    const v = pm.paths.get(key);
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

/**
 * The object holding accumulated leaves: its array children concatenate across
 * layers, every other child is plain last-wins.
 */
function concatParent(parts: PathMap[], key: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const pm of parts) {
    const v = pm.paths.get(key);
    if (!isPlainObject(v)) continue;
    for (const [child, value] of Object.entries(v)) {
      const prev = merged[child];
      merged[child] = CONCAT_LEAF_KEYS.has(`${key}.${child}`) && Array.isArray(value)
        ? [...(Array.isArray(prev) ? prev : []), ...value]
        : value;
    }
  }
  return merged;
}

/**
 * Merge already-read layers, lowest priority first. Pure — the file and DB
 * reads live in getEffectiveConfig, so the merge rules are testable on their
 * own.
 */
export function computeEffective(layers: ConfigLayerInfo[]): EffectiveConfigEntry[] {
  const pathMaps = layers.map(layer => {
    const paths = new Map<string, unknown>();
    for (const [k, v] of Object.entries(layer.raw)) {
      paths.set(k, v);
      if (isPlainObject(v)) for (const [k2, v2] of Object.entries(v)) paths.set(`${k}.${k2}`, v2);
    }
    return { level: layer.level, paths };
  });

  const allKeys = new Set<string>();
  for (const pm of pathMaps) for (const k of pm.paths.keys()) allKeys.add(k);

  const byRankDesc = (a: ConfigScope, b: ConfigScope) => (LEVEL_ORDER[b] ?? 0) - (LEVEL_ORDER[a] ?? 0);
  const effective: EffectiveConfigEntry[] = [];
  for (const key of allKeys) {
    const having = pathMaps.filter(pm => pm.paths.has(key));
    const honored = having.filter(pm => levelHonored(key, pm.level));
    // Everything defined only in ignored layers → still show the top value,
    // flagged sourceIgnored so the UI can warn "this never takes effect".
    const pool = honored.length ? honored : having;
    const winner = pool.reduce((a, b) => ((LEVEL_ORDER[b.level] ?? 0) > (LEVEL_ORDER[a.level] ?? 0) ? b : a));
    const overridden = honored.length
      ? honored.filter(pm => pm !== winner).map(pm => pm.level).sort(byRankDesc)
      : [];
    const ignored = having
      .filter(pm => !levelHonored(key, pm.level) && pm.level !== winner.level)
      .map(pm => pm.level).sort(byRankDesc);
    // `pool` is in layer order (user → project → local), i.e. ascending
    // priority, which is exactly the order the accumulated keys concatenate in.
    const accumulates = CONCAT_LEAF_KEYS.has(key) || CONCAT_PARENT_KEYS.has(key);
    effective.push({
      key,
      value: accumulates
        ? (CONCAT_LEAF_KEYS.has(key) ? concatLeaf(pool, key) : concatParent(pool, key))
        : winner.paths.get(key),
      source: winner.level,
      overriddenLevels: !accumulates && overridden.length ? overridden : undefined,
      mergedLevels: accumulates && pool.length > 1
        ? pool.map(pm => pm.level).sort(byRankDesc) : undefined,
      ignoredLevels: ignored.length ? ignored : undefined,
      sourceIgnored: honored.length === 0 ? true : undefined,
    });
  }

  effective.sort((a, b) => a.key.localeCompare(b.key));
  return effective;
}

/**
 * Read-only merged view of the settings layers (local > project > user):
 * every top-level key plus one level of nested leaves, with the winning
 * value, its source layer, which layers it overrides or accumulates across,
 * and which definitions sit in layers the tool never reads.
 */
export function getEffectiveConfig(db: Database, projectDir?: string): EffectiveConfigModel {
  if (projectDir && !listProjectDirs(db).some(p => pathKey(p) === pathKey(projectDir))) {
    throw new Error("projectDir is not one of the known projects");
  }

  const layers: ConfigLayerInfo[] = [readLayer(SETTINGS_PATH, "user")];
  // A project whose .claude IS ~/.claude contributes no layer of its own —
  // reading it would compare the user layer against itself.
  if (projectDir && !shadowsUserConfig(projectDir)) {
    layers.push(readLayer(join(projectDir, ".claude", "settings.json"), "project"));
    layers.push(readLayer(join(projectDir, ".claude", "settings.local.json"), "local"));
  }

  return { layers, effective: computeEffective(layers) };
}
