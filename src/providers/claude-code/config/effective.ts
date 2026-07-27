import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { SETTINGS_PATH } from "../../../paths";
import type { ConfigLayerInfo, ConfigScope, EffectiveConfigEntry, EffectiveConfigModel } from "../../../config/types";
import { listProjectDirs, pathKey } from "./shared";

const LEVEL_ORDER: Record<string, number> = { user: 1, project: 2, local: 3 };

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

/**
 * Read-only merged view of the settings layers (local > project > user):
 * every top-level key plus one level of nested leaves, with the winning
 * value, its source layer, which layers it overrides, and which definitions
 * sit in layers the tool never reads.
 */
export function getEffectiveConfig(db: Database, projectDir?: string): EffectiveConfigModel {
  if (projectDir && !listProjectDirs(db).some(p => pathKey(p) === pathKey(projectDir))) {
    throw new Error("projectDir is not one of the known projects");
  }

  const layers: ConfigLayerInfo[] = [readLayer(SETTINGS_PATH, "user")];
  if (projectDir) {
    layers.push(readLayer(join(projectDir, ".claude", "settings.json"), "project"));
    layers.push(readLayer(join(projectDir, ".claude", "settings.local.json"), "local"));
  }

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
    effective.push({
      key,
      value: winner.paths.get(key),
      source: winner.level,
      overriddenLevels: overridden.length ? overridden : undefined,
      ignoredLevels: ignored.length ? ignored : undefined,
      sourceIgnored: honored.length === 0 ? true : undefined,
    });
  }

  effective.sort((a, b) => a.key.localeCompare(b.key));
  return { layers, effective };
}
