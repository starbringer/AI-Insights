import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { countTokens } from "../tokenizer";
import { getDailySeries, getTotals } from "../transcripts/aggregate";
import { getThresholds, statusForValue, type Status } from "../thresholds";
import { GLOBAL_CLAUDE_MD } from "../paths";

export interface ClaudeMdFile {
  path: string;
  label: string;
  words: number;
  tokens: number;
}

export interface ClaudeMdAudit {
  status: Status;
  files: ClaudeMdFile[];
  totalWords: number;
  totalTokens: number;
  sessionCount30d: number;
  estimatedInjectedTokens30d: number;
  dailySeries: { date: string; injectedTokens: number }[];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function analyzeFile(path: string, label: string): ClaudeMdFile | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  return { path, label, words: countWords(text), tokens: countTokens(text) };
}

export function getClaudeMdAudit(db: Database, projectPaths: string[] = []): ClaudeMdAudit {
  const t = getThresholds();

  const files: ClaudeMdFile[] = [];
  const global = analyzeFile(GLOBAL_CLAUDE_MD, "Global (~/.claude/CLAUDE.md)");
  if (global) files.push(global);
  for (const p of projectPaths) {
    const f = analyzeFile(join(p, "CLAUDE.md"), `Project (${p})`);
    if (f) files.push(f);
    const sub = analyzeFile(join(p, ".claude", "CLAUDE.md"), `Project (.claude/CLAUDE.md in ${p})`);
    if (sub) files.push(sub);
  }

  const totalWords  = files.reduce((s, f) => s + f.words, 0);
  const totalTokens = files.reduce((s, f) => s + f.tokens, 0);

  const daily30d = getDailySeries(db, 30);
  const sessionCount30d = db.query<{ n: number }, []>(
    `SELECT COUNT(DISTINCT session_id) as n FROM turns WHERE ts >= date('now','-30 days')`
  ).get()?.n ?? 0;

  const estimatedInjectedTokens30d = totalTokens * sessionCount30d;

  const dailySeries = daily30d.map(d => ({
    date: d.date,
    injectedTokens: totalTokens,
  }));

  const status = statusForValue(totalWords, t.claudeMdWordsWarn, t.claudeMdWordsError);

  return { status, files, totalWords, totalTokens, sessionCount30d, estimatedInjectedTokens30d, dailySeries };
}
