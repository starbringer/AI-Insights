import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { countTokens } from "../tokenizer";
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
  agentCount30d: number;
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

  // When no explicit project list is given, audit every project the
  // transcripts have actually touched (distinct cwd of recorded agents).
  let projects = projectPaths;
  if (projects.length === 0) {
    projects = db.query<{ cwd: string }, []>(
      `SELECT DISTINCT cwd FROM agents WHERE cwd IS NOT NULL`
    ).all().map(r => r.cwd);
  }
  // Windows paths are case-insensitive; transcripts can record the same project
  // with different drive-letter/segment casing (e.g. "C:\Foo" vs "c:\Foo"), so
  // case-fold there to dedupe. On case-sensitive filesystems (macOS/Linux) key
  // verbatim, or two genuinely distinct project dirs differing only in case
  // collapse into one and lose a CLAUDE.md from the audit.
  const seen = new Set<string>();
  for (const p of projects) {
    for (const candidate of [join(p, "CLAUDE.md"), join(p, ".claude", "CLAUDE.md")]) {
      const key = process.platform === "win32" ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = analyzeFile(candidate, `Project (${candidate})`);
      if (f) files.push(f);
    }
  }

  const totalWords  = files.reduce((s, f) => s + f.words, 0);
  const totalTokens = files.reduce((s, f) => s + f.tokens, 0);
  const globalTokens = global?.tokens ?? 0;

  // CLAUDE.md is injected once per agent (one transcript file = one agent).
  const agentCount30d = db.query<{ n: number }, []>(
    `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= date('now','-30 days')`
  ).get()?.n ?? 0;

  // The global file is injected into every agent; project files only into
  // agents of that project. Using the global size per agent keeps the
  // estimate honest instead of multiplying every project file everywhere.
  const estimatedInjectedTokens30d = globalTokens * agentCount30d;

  // Real shape: tokens injected per day = global tokens × agents active that day.
  const agentsPerDay = db.query<{ date: string; n: number }, []>(
    `SELECT date(ts,'localtime') as date, COUNT(DISTINCT agent_id) as n
     FROM turns WHERE ts >= date('now','-30 days')
     GROUP BY date(ts,'localtime') ORDER BY date`
  ).all();
  const dailySeries = agentsPerDay.map(d => ({
    date: d.date,
    injectedTokens: globalTokens * d.n,
  }));

  const status = statusForValue(totalWords, t.claudeMdWordsWarn, t.claudeMdWordsError);

  return { status, files, totalWords, totalTokens, agentCount30d, estimatedInjectedTokens30d, dailySeries };
}
