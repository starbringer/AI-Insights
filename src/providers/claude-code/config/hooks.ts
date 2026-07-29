import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Database } from "bun:sqlite";
import { CLAUDE_DIR, SETTINGS_PATH, CLAUDE_JSON_PATH } from "../../../paths";
import type { HookActionInfo, HookEntryInfo, HooksReport, ConfigScope } from "../../../config/types";
import { getRetentionDays, retentionCutoffIso } from "../../../retention";
import { listConfigLayerDirs, pathKey, readJsonFile } from "./shared";

interface RawMatcher {
  matcher?: string;
  hooks?: Record<string, unknown>[];
  [k: string]: unknown;
}

const SCRIPT_EXT_RE = /\.(ps1|sh|bash|zsh|js|mjs|cjs|ts|py|cmd|bat)$/i;

/**
 * Find the script file a hook command runs, if any: split the command line
 * (quote-aware), take the first token with a script extension, and resolve it
 * against the project dir / ~/.claude / as-is when absolute. Only paths that
 * actually exist are reported — the UI offers view/edit for those.
 */
export function detectScriptPath(command: string | undefined, projectDir?: string): string | undefined {
  if (!command) return undefined;
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  for (const rawTok of tokens) {
    const tok = rawTok.replace(/^["']|["']$/g, "");
    if (!SCRIPT_EXT_RE.test(tok)) continue;
    const candidates = isAbsolute(tok)
      ? [tok]
      : [projectDir ? join(projectDir, tok) : null, join(CLAUDE_DIR, tok)].filter((c): c is string => c !== null);
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return undefined;
}

function toAction(raw: Record<string, unknown>, projectDir?: string): HookActionInfo {
  const type = raw["type"] === "http" || (!raw["type"] && raw["url"]) ? "http"
    : raw["type"] === "prompt" || (raw["prompt"] && !raw["command"]) ? "prompt"
    : "command";
  const command = typeof raw["command"] === "string" ? raw["command"] : undefined;
  return {
    type,
    command,
    url: typeof raw["url"] === "string" ? raw["url"] : undefined,
    prompt: typeof raw["prompt"] === "string" ? raw["prompt"] : undefined,
    timeout: typeof raw["timeout"] === "number" ? raw["timeout"] : undefined,
    scriptPath: type === "command" ? detectScriptPath(command, projectDir) : undefined,
  };
}

function collectFromFile(path: string, level: ConfigScope, projectDir: string | undefined, out: HookEntryInfo[]): void {
  const settings = readJsonFile<{ hooks?: Record<string, RawMatcher[]> }>(path);
  if (!settings?.hooks || typeof settings.hooks !== "object") return;
  for (const [event, matchers] of Object.entries(settings.hooks)) {
    if (!Array.isArray(matchers)) continue;
    matchers.forEach((m, i) => {
      const rawHooks = Array.isArray(m?.hooks) ? m.hooks : [m as Record<string, unknown>];
      out.push({
        event,
        matcher: typeof m?.matcher === "string" && m.matcher ? m.matcher : undefined,
        actions: rawHooks.map(h => toAction(h, projectDir)),
        level,
        sourcePath: path,
        projectDir,
        matcherIndex: i,
        fires: 0,
      });
    });
  }
}

/**
 * Recorded fire counts per entry, over the retention window, from the
 * transcript event stream. Attribution rules:
 *   UserPromptSubmit → real prompts; SessionStart → agents started;
 *   Stop/SubagentStop → logged stop-hook fires; Pre/PostToolUse → tool calls
 *   matched against the entry's matcher; PreCompact → compactions.
 */
function attachFireCounts(db: Database, entries: HookEntryInfo[]): void {
  const cutoff = retentionCutoffIso();
  const count = (kind: string): number =>
    db.query<{ n: number }, [string, string]>(
      `SELECT COUNT(*) as n FROM events WHERE kind = ? AND ts >= ?`
    ).get(kind, cutoff)?.n ?? 0;

  const prompts = count("prompt");
  const hookFires = count("hook");
  const compacts = count("compact");
  const agents = db.query<{ n: number }, [string]>(
    `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= ?`
  ).get(cutoff)?.n ?? 0;

  const toolCounts = db.query<{ detail: string; n: number }, [string]>(
    `SELECT detail, COUNT(*) as n FROM events
     WHERE kind='tool' AND ts >= ? GROUP BY detail`
  ).all(cutoff);
  const totalTools = toolCounts.reduce((s, r) => s + r.n, 0);

  const toolFiresFor = (matcher?: string): number => {
    if (!matcher || matcher === "*" || matcher === ".*") return totalTools;
    try {
      const re = new RegExp(`^(${matcher})$`);
      return toolCounts.filter(r => re.test(r.detail ?? "")).reduce((s, r) => s + r.n, 0);
    } catch { return totalTools; }
  };

  for (const e of entries) {
    if (e.event === "UserPromptSubmit") e.fires = prompts;
    else if (e.event === "SessionStart") e.fires = agents;
    else if (e.event === "Stop" || e.event === "SubagentStop") e.fires = hookFires;
    else if (e.event === "PreToolUse" || e.event === "PostToolUse") e.fires = toolFiresFor(e.matcher);
    else if (e.event === "PreCompact") e.fires = compacts;
  }
}

export function listHooks(db: Database): HooksReport {
  const entries: HookEntryInfo[] = [];
  collectFromFile(SETTINGS_PATH, "user", undefined, entries);
  // Newer Claude Code versions can also carry hooks in ~/.claude.json.
  if (existsSync(CLAUDE_JSON_PATH)) collectFromFile(CLAUDE_JSON_PATH, "user", undefined, entries);
  for (const dir of listConfigLayerDirs(db)) {
    collectFromFile(join(dir, ".claude", "settings.json"), "project", dir, entries);
    collectFromFile(join(dir, ".claude", "settings.local.json"), "local", dir, entries);
  }
  attachFireCounts(db, entries);
  return {
    entries,
    totalFires: entries.reduce((s, e) => s + e.fires, 0),
    windowDays: getRetentionDays(),
  };
}

/** Script reads/writes only touch paths listHooks itself detected. */
function assertKnownScript(db: Database, path: string): void {
  const known = listHooks(db).entries.some(e =>
    e.actions.some(a => a.scriptPath && pathKey(a.scriptPath) === pathKey(path)));
  if (!known) throw new Error("path is not a script referenced by any enumerated hook");
}

export function readHookScript(db: Database, path: string): { path: string; content: string } {
  assertKnownScript(db, path);
  return { path, content: readFileSync(path, "utf-8") };
}

export function writeHookScript(db: Database, path: string, content: string): void {
  assertKnownScript(db, path);
  writeFileSync(path, content, "utf-8");
}

/**
 * Remove one matcher entry (hooks.<event>[matcherIndex]) from a settings
 * file. Read-modify-write of the whole JSON keeps every other field intact;
 * the associated script file is deliberately left on disk. The sourcePath
 * must be one this adapter enumerated — no arbitrary-file edits.
 */
export function deleteHook(db: Database, ref: { sourcePath: string; event: string; matcherIndex: number }): void {
  const known = listHooks(db).entries.some(e =>
    pathKey(e.sourcePath) === pathKey(ref.sourcePath)
    && e.event === ref.event && e.matcherIndex === ref.matcherIndex);
  if (!known) throw new Error("hook entry not found among enumerated hooks");

  const raw = JSON.parse(readFileSync(ref.sourcePath, "utf-8")) as Record<string, unknown>;
  const hooks = raw["hooks"];
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("no hooks object in file");
  const arr = (hooks as Record<string, unknown>)[ref.event];
  if (!Array.isArray(arr) || ref.matcherIndex >= arr.length) throw new Error("hook entry vanished — reload and retry");
  arr.splice(ref.matcherIndex, 1);
  if (arr.length === 0) delete (hooks as Record<string, unknown>)[ref.event];
  if (Object.keys(hooks as Record<string, unknown>).length === 0) delete raw["hooks"];
  writeFileSync(ref.sourcePath, JSON.stringify(raw, null, 2), "utf-8");
}
