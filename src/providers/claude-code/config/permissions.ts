import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { SETTINGS_PATH } from "../../../paths";
import type {
  ConfigScope, PermissionModelInfo, PermissionLayerInfo, PermissionRuleInfo, PermissionParam,
} from "../../../config/types";
import { listProjectDirs, pathKey, readJsonFile, shadowsUserConfig } from "./shared";

const LEVEL_RANK: Record<string, number> = { user: 1, project: 2, local: 3 };

/** Tools whose rule argument is a single whole value (paths / command prefixes), not key:value pairs. */
const WHOLE_VALUE_TOOLS = new Set(["Bash", "Read", "Write", "Edit"]);

/** Parse "Tool", "Tool(arg)" or "Tool(key:value, key2:v2)" into structure. */
export function parsePermissionRule(raw: string): { raw: string; tool: string; params: PermissionParam[] } {
  const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/);
  if (!m) return { raw, tool: raw, params: [] };
  const tool = m[1]!;
  const inner = m[2]?.trim();
  if (!inner) return { raw, tool, params: [] };
  const hasGlob = (s: string) => /[*]/.test(s);
  if (WHOLE_VALUE_TOOLS.has(tool)) {
    return { raw, tool, params: [{ key: "", value: inner, isGlob: hasGlob(inner) }] };
  }
  const params = inner.split(",").map(s => s.trim()).filter(Boolean).map(seg => {
    const ci = seg.indexOf(":");
    if (ci === -1) return { key: "", value: seg, isGlob: hasGlob(seg) };
    return { key: seg.slice(0, ci).trim(), value: seg.slice(ci + 1).trim(), isGlob: hasGlob(seg.slice(ci + 1)) };
  });
  return { raw, tool, params };
}

function layerFromFile(path: string, level: ConfigScope): PermissionLayerInfo {
  const settings = readJsonFile<{ permissions?: Record<string, unknown> }>(path);
  const perms = settings?.permissions && typeof settings.permissions === "object" ? settings.permissions : {};
  const rules = (effect: "allow" | "deny" | "ask"): PermissionRuleInfo[] => {
    const arr = Array.isArray((perms as Record<string, unknown>)[effect])
      ? ((perms as Record<string, unknown>)[effect] as unknown[]) : [];
    return arr.filter((r): r is string => typeof r === "string")
      .map(rawRule => ({ ...parsePermissionRule(rawRule), effect, level }));
  };
  return {
    level, filePath: path, exists: existsSync(path),
    allow: rules("allow"), deny: rules("deny"), ask: rules("ask"),
  };
}

/**
 * Three-layer permission view (local > project > user). Without a project the
 * model contains just the user layer. Duplicate rules (same effect + raw
 * string) at multiple layers mark the lower ones overriddenBy the highest.
 */
export function getPermissionModel(db: Database, projectDir?: string): PermissionModelInfo {
  if (projectDir && !listProjectDirs(db).some(p => pathKey(p) === pathKey(projectDir))) {
    throw new Error("projectDir is not one of the known projects");
  }

  const layers: PermissionLayerInfo[] = [layerFromFile(SETTINGS_PATH, "user")];
  // ~/.claude as a project dir would read the user layer a second time and
  // mark every rule as overriding itself.
  if (projectDir && !shadowsUserConfig(projectDir)) {
    layers.push(layerFromFile(join(projectDir, ".claude", "settings.json"), "project"));
    layers.push(layerFromFile(join(projectDir, ".claude", "settings.local.json"), "local"));
  }

  const all = layers.flatMap(l => [...l.allow, ...l.deny, ...l.ask]);
  const groups = new Map<string, PermissionRuleInfo[]>();
  for (const r of all) {
    const k = `${r.effect} ${r.raw}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const winner = group.reduce((a, b) =>
      (LEVEL_RANK[b.level] ?? 0) > (LEVEL_RANK[a.level] ?? 0) ? b : a);
    for (const r of group) if (r !== winner) r.overriddenBy = winner.level;
  }

  return { layers, effective: all.filter(r => !r.overriddenBy) };
}
