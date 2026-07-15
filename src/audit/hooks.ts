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
  // Hooks can live in settings.json or in .claude.json (newer Claude Code
  // versions). Merge per-event so one file doesn't clobber the other.
  const hooks: Record<string, unknown[]> = {};
  for (const p of [SETTINGS_PATH, CLAUDE_JSON_PATH]) {
    if (!existsSync(p)) continue;
    try {
      const s = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      const h = s["hooks"];
      if (h && typeof h === "object") {
        for (const [event, value] of Object.entries(h as Record<string, unknown>)) {
          if (Array.isArray(value)) hooks[event] = [...(hooks[event] ?? []), ...value];
        }
      }
    } catch { /* skip */ }
  }
  return { hooks };
}

function extractEntries(settings: Record<string, unknown>): HookEntry[] {
  const hooks = settings["hooks"];
  if (!hooks || typeof hooks !== "object") return [];
  const entries: HookEntry[] = [];
  for (const [event, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push({
          event,
          matcher: typeof item?.matcher === "string" ? item.matcher : undefined,
          hooks: Array.isArray(item?.hooks) ? item.hooks : [item],
        });
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

  // Fire counts come from the recorded event stream where possible:
  //   prompts   → UserPromptSubmit fires (real prompt count, not API calls)
  //   tools     → Pre/PostToolUse fires (filtered by the entry's matcher)
  //   hook rows → Stop-hook fires actually logged in transcripts
  //   compact   → PreCompact fires
  const count = (kind: string): number =>
    db.query<{ n: number }, [string]>(
      `SELECT COUNT(*) as n FROM events WHERE kind = ? AND ts >= date('now','-7 days')`
    ).get(kind)?.n ?? 0;

  const prompts7d = count("prompt");
  const hookFires7d = count("hook");
  const compact7d = count("compact");
  const agents7d = db.query<{ n: number }, []>(
    `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= date('now','-7 days')`
  ).get()?.n ?? 0;

  const toolCounts = db.query<{ detail: string; n: number }, []>(
    `SELECT detail, COUNT(*) as n FROM events
     WHERE kind='tool' AND ts >= date('now','-7 days') GROUP BY detail`
  ).all();
  const totalTools7d = toolCounts.reduce((s, r) => s + r.n, 0);

  const toolFiresFor = (matcher?: string): number => {
    if (!matcher || matcher === "*" || matcher === ".*") return totalTools7d;
    try {
      const re = new RegExp(`^(${matcher})$`);
      return toolCounts.filter(r => re.test(r.detail ?? "")).reduce((s, r) => s + r.n, 0);
    } catch {
      return totalTools7d;
    }
  };

  const fires7d: HookFires[] = entries.map(e => {
    let fires = 0;
    if (e.event === "UserPromptSubmit") fires = prompts7d;
    else if (e.event === "SessionStart") fires = agents7d;
    else if (e.event === "Stop" || e.event === "SubagentStop") fires = hookFires7d;
    else if (e.event === "PreToolUse" || e.event === "PostToolUse") fires = toolFiresFor(e.matcher);
    else if (e.event === "PreCompact") fires = compact7d;
    const label = e.matcher ? `${e.event} (${e.matcher})` : e.event;
    return { event: label, fires7d: fires, estimatedTokens: fires * 150 };
  });

  const maxUps = userPromptSubmitCount;
  const maxSs  = sessionStartCount;
  const status: Status =
    maxUps >= t.userPromptSubmitHooks || maxSs >= t.sessionStartHooks ? "warn" : "ok";

  return { status, entries, userPromptSubmitCount, sessionStartCount, fires7d };
}
