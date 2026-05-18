import { readFileSync, existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { SETTINGS_PATH, CLAUDE_JSON_PATH } from "../paths";
import { getThresholds, statusForValue, type Status } from "../thresholds";

export interface HookEntry {
  event: string;
  matcher?: string;
  hooks: { type: string; command?: string; script?: string }[];
}

export interface HookFires {
  event: string;
  fires7d: number;
  estimatedTokens: number;
}

export interface HooksAudit {
  status: Status;
  entries: HookEntry[];
  userPromptSubmitCount: number;
  sessionStartCount: number;
  fires7d: HookFires[];
}

function readSettings(): Record<string, unknown> {
  // Hooks can live in settings.json or in .claude.json (newer Claude Code versions)
  const merged: Record<string, unknown> = {};
  for (const p of [SETTINGS_PATH, CLAUDE_JSON_PATH]) {
    if (!existsSync(p)) continue;
    try {
      const s = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      if (s["hooks"]) merged["hooks"] = s["hooks"];
    } catch { /* skip */ }
  }
  return merged;
}

function extractEntries(settings: Record<string, unknown>): HookEntry[] {
  const hooks = settings["hooks"];
  if (!hooks || typeof hooks !== "object") return [];
  const entries: HookEntry[] = [];
  for (const [event, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push({ event, hooks: Array.isArray(item?.hooks) ? item.hooks : [item] });
      }
    }
  }
  return entries;
}

export function getHooksAudit(db: Database): HooksAudit {
  const t = getThresholds();
  const settings = readSettings();
  const entries = extractEntries(settings);

  const userPromptSubmitCount = entries.filter(e => e.event === "UserPromptSubmit").length;
  const sessionStartCount     = entries.filter(e => e.event === "SessionStart").length;

  // Estimate fires from DB: turns ≈ UserPromptSubmit fires, sessions ≈ SessionStart fires
  const turns7d = db.query<{ n: number }, []>(
    `SELECT COUNT(*) as n FROM turns WHERE ts >= date('now','-7 days')`
  ).get()?.n ?? 0;
  const sessions7d = db.query<{ n: number }, []>(
    `SELECT COUNT(DISTINCT session_id) as n FROM turns WHERE ts >= date('now','-7 days')`
  ).get()?.n ?? 0;

  const fires7d: HookFires[] = entries.map(e => {
    let fires = 0;
    if (e.event === "UserPromptSubmit") fires = turns7d;
    else if (e.event === "SessionStart") fires = sessions7d;
    else if (e.event === "PreToolUse" || e.event === "PostToolUse") fires = Math.round(turns7d * 2);
    return { event: e.event, fires7d: fires, estimatedTokens: fires * 150 };
  });

  const maxUps = userPromptSubmitCount;
  const maxSs  = sessionStartCount;
  const status: Status =
    maxUps >= t.userPromptSubmitHooks || maxSs >= t.sessionStartHooks ? "warn" : "ok";

  return { status, entries, userPromptSubmitCount, sessionStartCount, fires7d };
}
