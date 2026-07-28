import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { countTokens } from "../../../tokenizer";
import { CLAUDE_DIR } from "../../../paths";
import type { CommandInfo } from "../../../config/types";
import { listProjectDirs, listConfigLayerDirs, parseFrontmatter, enabledPluginDirs, markOverrides, pathKey } from "./shared";

const USER_COMMANDS_DIR = join(CLAUDE_DIR, "commands");

interface ScanOpts {
  source: "user" | "project" | "plugin";
  projectDir?: string;
  pluginName?: string;
  marketplace?: string;
  version?: string;
  pluginScope?: "user" | "project";
}

/**
 * Recursively scan a commands root for *.md. Command name = path relative to
 * the root, ".md" stripped, subdirectories joined with ":" (Claude Code's
 * namespace convention). The historical <name>/<name>.md layout collapses to
 * <name> for user/project sources; plugins keep the literal namespacing.
 */
function scanCommandDir(dir: string, opts: ScanOpts, out: CommandInfo[]): void {
  const walk = (cur: string, prefix: string[]): void => {
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = join(cur, ent.name);
      try { if (lstatSync(full).isSymbolicLink()) continue; } catch { continue; }
      if (ent.isDirectory()) {
        walk(full, [...prefix, ent.name]);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const segs = [...prefix, ent.name.slice(0, -3)];
        if (opts.source !== "plugin" && segs.length >= 2 && segs[segs.length - 1] === segs[segs.length - 2]) segs.pop();
        const name = segs.join(":");
        let content: string;
        try { content = readFileSync(full, "utf-8"); } catch { continue; }
        const { meta, body } = parseFrontmatter(content);
        out.push({
          name,
          invokeName: opts.source === "plugin" ? `${opts.pluginName}:${name}` : name,
          description: meta["description"] ?? "",
          argumentHint: meta["argument-hint"] || undefined,
          usesArguments: /\$ARGUMENTS\b|\$[1-9]\b/.test(body) || undefined,
          source: opts.source,
          projectDir: opts.projectDir,
          pluginName: opts.pluginName,
          marketplace: opts.marketplace,
          version: opts.version,
          path: full,
          content,
          tokens: countTokens(content),
          editable: opts.source !== "plugin",
        });
      }
    }
  };
  walk(dir, []);
}

export function listCommands(db: Database): CommandInfo[] {
  const out: CommandInfo[] = [];
  scanCommandDir(USER_COMMANDS_DIR, { source: "user" }, out);
  for (const dir of listConfigLayerDirs(db)) {
    scanCommandDir(join(dir, ".claude", "commands"), { source: "project", projectDir: dir }, out);
  }
  for (const { dir, plugin } of enabledPluginDirs("commands")) {
    scanCommandDir(dir, {
      source: "plugin", pluginName: plugin.pluginName, marketplace: plugin.marketplace,
      version: plugin.version, pluginScope: plugin.scope,
    }, out);
  }
  markOverrides(out);
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

function assertEditablePath(db: Database, path: string): void {
  const hit = listCommands(db).find(c => pathKey(c.path) === pathKey(path));
  if (!hit) throw new Error("path is not one of the enumerated command files");
  if (!hit.editable) throw new Error("plugin commands are read-only");
}

export function writeCommandFile(db: Database, path: string, content: string): void {
  assertEditablePath(db, path);
  writeFileSync(path, content, "utf-8");
}

const NAME_RE = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/;

export function createCommand(
  db: Database,
  opts: { location: "user" | "project"; projectDir?: string; name: string; content: string },
): { path: string } {
  if (!NAME_RE.test(opts.name)) {
    throw new Error("command name must be lowercase letters/digits/hyphens, ':' for namespaces");
  }
  let base: string;
  if (opts.location === "project") {
    const dir = opts.projectDir ?? "";
    if (!listProjectDirs(db).some(p => pathKey(p) === pathKey(dir))) {
      throw new Error("projectDir is not one of the known projects");
    }
    base = join(dir, ".claude", "commands");
  } else {
    base = USER_COMMANDS_DIR;
  }
  const segs = opts.name.split(":");
  const path = join(base, ...segs.slice(0, -1), `${segs[segs.length - 1]}.md`);
  if (existsSync(path)) throw new Error(`command file already exists: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, opts.content, "utf-8");
  return { path };
}

export function deleteCommand(db: Database, path: string): void {
  assertEditablePath(db, path);
  unlinkSync(path);
  // Clean up the historical <name>/<name>.md wrapper dir when it empties.
  try {
    const dir = dirname(path);
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch { /* best-effort */ }
}
