import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { countTokens } from "../../../tokenizer";
import { GLOBAL_CLAUDE_MD } from "../../../paths";
import type { InstructionFile, InstructionsReport } from "../../../config/types";
import { listProjectDirs, pathKey } from "./shared";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function fileEntry(path: string, label: string, scope: "global" | "project", projectDir?: string): InstructionFile {
  const exists = existsSync(path);
  let tokens = 0, words = 0;
  if (exists) {
    try {
      const text = readFileSync(path, "utf-8");
      tokens = countTokens(text);
      words = countWords(text);
    } catch { /* unreadable — keep zeros */ }
  }
  return { path, label, scope, projectDir, exists, editable: true, tokens, words };
}

/**
 * Enumerate every CLAUDE.md this install can inject: the global one plus, for
 * each project the transcripts have touched, <project>/CLAUDE.md and
 * <project>/.claude/CLAUDE.md. Non-existent candidates are listed too (with
 * exists:false) so the editor can create them.
 */
export function listInstructionFiles(db: Database): InstructionFile[] {
  const files: InstructionFile[] = [
    fileEntry(GLOBAL_CLAUDE_MD, "Global (~/.claude/CLAUDE.md)", "global"),
  ];
  const seen = new Set<string>([pathKey(GLOBAL_CLAUDE_MD)]);
  for (const dir of listProjectDirs(db)) {
    const projName = basename(dir.replace(/[\\/]+$/, "")) || dir;
    for (const candidate of [join(dir, "CLAUDE.md"), join(dir, ".claude", "CLAUDE.md")]) {
      const key = pathKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = candidate.endsWith(join(".claude", "CLAUDE.md")) ? ".claude/CLAUDE.md" : "CLAUDE.md";
      files.push(fileEntry(candidate, `${projName} — ${sub}`, "project", dir));
    }
  }
  // Existing files first (global stays on top), then creatable placeholders.
  return files.sort((a, b) =>
    (a.scope === "global" ? -1 : b.scope === "global" ? 1 : 0) || Number(b.exists) - Number(a.exists));
}

export function getInstructionsReport(db: Database): InstructionsReport {
  const files = listInstructionFiles(db);
  const globalTokens = files.find(f => f.scope === "global")?.tokens ?? 0;

  const agentCount30d = db.query<{ n: number }, []>(
    `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= date('now','-30 days')`
  ).get()?.n ?? 0;

  const agentsPerDay = db.query<{ date: string; n: number }, []>(
    `SELECT date(ts,'localtime') as date, COUNT(DISTINCT agent_id) as n
     FROM turns WHERE ts >= date('now','-30 days')
     GROUP BY date(ts,'localtime') ORDER BY date`
  ).all();

  return {
    files,
    injection: {
      agentCount30d,
      estimatedInjectedTokens30d: globalTokens * agentCount30d,
      dailySeries: agentsPerDay.map(d => ({ date: d.date, injectedTokens: globalTokens * d.n })),
    },
  };
}

/** Writes/reads only touch paths this adapter itself enumerated. */
function assertKnownPath(db: Database, path: string): void {
  const known = listInstructionFiles(db).some(f => pathKey(f.path) === pathKey(path));
  if (!known) throw new Error("path is not one of the enumerated instruction files");
}

export function readInstructionFile(db: Database, path: string): { path: string; content: string } | null {
  assertKnownPath(db, path);
  if (!existsSync(path)) return { path, content: "" };
  return { path, content: readFileSync(path, "utf-8") };
}

export function writeInstructionFile(db: Database, path: string, content: string): void {
  assertKnownPath(db, path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}
