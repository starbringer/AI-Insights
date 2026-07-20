import type { Database } from "bun:sqlite";
import { computeCost } from "../pricing";

export interface TurnTotals {
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
  totalCost: number;
}

export interface DailyStat {
  date: string;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface AgentSummaryRow {
  agent_id: string;
  provider: string;
  run_id: string;
  title: string | null;
  cwd: string | null;
  project_flat: string | null;
  model: string | null;
  is_subagent: number;
  parent_agent_id: string | null;
  agent_type: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  turn_count: number;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface ModelStat {
  model: string;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

/**
 * ISO timestamp of local midnight n days ago. Turn timestamps are stored as
 * UTC ISO strings, so comparing against a bare "YYYY-MM-DD" would cut days at
 * UTC midnight — hours off for any non-UTC user. Anchoring to local midnight
 * (converted to UTC) makes "today" mean the user's calendar day.
 */
export function localMidnightIso(daysAgo = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export function getTotals(db: Database, sinceDate?: string): TurnTotals {
  const where = sinceDate ? `WHERE ts >= '${sinceDate}'` : "";
  const row = db.query<{
    input: number; cw5m: number; cw1h: number; cr: number; out: number;
  }, []>(
    `SELECT
       SUM(input_tokens) as input,
       SUM(cache_create_5m) as cw5m,
       SUM(cache_create_1h) as cw1h,
       SUM(cache_read) as cr,
       SUM(output_tokens) as out
     FROM turns ${where}`
  ).get();

  const input  = row?.input  ?? 0;
  const cw5m   = row?.cw5m   ?? 0;
  const cw1h   = row?.cw1h   ?? 0;
  const cr     = row?.cr     ?? 0;
  const output = row?.out    ?? 0;
  const total  = input + cw5m + cw1h + cr + output;

  const byModel = getModelStats(db, sinceDate);
  const totalCost = byModel.reduce((sum, m) => {
    const c = computeCost(m.model, m.input, m.output, m.cacheCreate5m, m.cacheCreate1h, m.cacheRead);
    return sum + c.total;
  }, 0);

  return { input, cacheCreate5m: cw5m, cacheCreate1h: cw1h, cacheRead: cr, output, total, totalCost };
}

// ===== Time ranges for the dashboard's per-chart range buttons =====

export type RangeKey = "1h" | "24h" | "7d" | "30d";

export function parseRange(raw: string | undefined): RangeKey | null {
  return raw === "1h" || raw === "24h" || raw === "7d" || raw === "30d" ? raw : null;
}

/**
 * Window start for a range. Hour-scale ranges are rolling (literal "last N
 * hours"); day-scale ranges anchor to local midnight so daily buckets line up
 * with calendar days ("last 7 days" = today plus the 6 days before it).
 */
export function rangeSinceIso(range: RangeKey): string {
  switch (range) {
    case "1h":  return new Date(Date.now() - 3600_000).toISOString();
    case "24h": return new Date(Date.now() - 24 * 3600_000).toISOString();
    case "7d":  return localMidnightIso(6);
    case "30d": return localMidnightIso(29);
  }
}

// Bucket granularity per range: 5-minute slices for 1h, hours for 24h,
// calendar days otherwise. Labels are local time.
function bucketExpr(range: RangeKey): string {
  switch (range) {
    case "1h":
      return `strftime('%H:', ts, 'localtime') || printf('%02d', (CAST(strftime('%M', ts, 'localtime') AS INTEGER) / 5) * 5)`;
    case "24h":
      return `strftime('%m-%d %H:00', ts, 'localtime')`;
    default:
      return `date(ts, 'localtime')`;
  }
}

/** Token series bucketed to match the range: 5-min / hourly / daily. */
export function getRangeSeries(db: Database, range: RangeKey): DailyStat[] {
  const bucket = bucketExpr(range);
  return db.query<DailyStat, [string]>(
    `SELECT
       ${bucket} as date,
       SUM(input_tokens)    as input,
       SUM(cache_create_5m) as cacheCreate5m,
       SUM(cache_create_1h) as cacheCreate1h,
       SUM(cache_read)      as cacheRead,
       SUM(output_tokens)   as output,
       SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns WHERE ts >= ?
     GROUP BY ${bucket}
     ORDER BY MIN(ts)`
  ).all(rangeSinceIso(range));
}

export function getDailySeries(db: Database, days = 30): DailyStat[] {
  const since = localMidnightIso(days);
  return db.query<DailyStat, [string]>(
    `SELECT
       date(ts, 'localtime') as date,
       SUM(input_tokens)    as input,
       SUM(cache_create_5m) as cacheCreate5m,
       SUM(cache_create_1h) as cacheCreate1h,
       SUM(cache_read)      as cacheRead,
       SUM(output_tokens)   as output,
       SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns WHERE ts >= ?
     GROUP BY date(ts, 'localtime')
     ORDER BY date`
  ).all(since);
}

export function getModelStats(db: Database, sinceDate?: string): ModelStat[] {
  // Parameterized because /api/models passes the caller-supplied `since`
  // straight through; empty string compares <= every ISO ts, i.e. no filter.
  return db.query<ModelStat, [string]>(
    `SELECT
       COALESCE(model, 'unknown') as model,
       SUM(input_tokens)    as input,
       SUM(cache_create_5m) as cacheCreate5m,
       SUM(cache_create_1h) as cacheCreate1h,
       SUM(cache_read)      as cacheRead,
       SUM(output_tokens)   as output,
       SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns WHERE ts >= ?
     GROUP BY model
     ORDER BY total DESC`
  ).all(sinceDate ?? "");
}

export function getAgents(db: Database, opts: {
  limit?: number; offset?: number; project?: string; search?: string;
} = {}): { rows: AgentSummaryRow[]; total: number } {
  const { limit = 50, offset = 0, project, search } = opts;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (project) { conditions.push("a.cwd = ?"); params.push(project); }
  if (search) { conditions.push("(a.title LIKE ? OR a.cwd LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const allParams = [...params, limit, offset];

  const countRow = db.query(
    `SELECT COUNT(*) as n FROM agents a ${where}`
  ).get(...params) as { n: number } | null;

  const rows = db.query(
    `SELECT
       a.agent_id, a.provider, a.run_id, a.title, a.cwd, a.project_flat,
       a.is_subagent, a.parent_agent_id, a.agent_type,
       a.started_at, a.last_seen_at, a.turn_count,
       t.model,
       COALESCE(t.input, 0)  as input,
       COALESCE(t.cw5m, 0)   as cacheCreate5m,
       COALESCE(t.cw1h, 0)   as cacheCreate1h,
       COALESCE(t.cr, 0)     as cacheRead,
       COALESCE(t.out, 0)    as output,
       COALESCE(t.total, 0)  as total
     FROM agents a
     LEFT JOIN (
       SELECT agent_id,
         MAX(model) as model,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cw5m,
         SUM(cache_create_1h) as cw1h,
         SUM(cache_read)      as cr,
         SUM(output_tokens)   as out,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns GROUP BY agent_id
     ) t ON a.agent_id = t.agent_id
     ${where}
     ORDER BY a.last_seen_at DESC NULLS LAST
     LIMIT ? OFFSET ?`
  ).all(...allParams) as AgentSummaryRow[];

  return { rows, total: countRow?.n ?? 0 };
}

export function getProjects(db: Database, since?: string): {
  cwd: string; runCount: number; agentCount: number; totalTokens: number; lastActive: string | null;
}[] {
  return db.query<{
    cwd: string; runCount: number; agentCount: number; totalTokens: number; lastActive: string | null;
  }, [string]>(
    `SELECT
       a.cwd,
       COUNT(DISTINCT a.run_id) as runCount,
       COUNT(DISTINCT a.agent_id) as agentCount,
       COALESCE(SUM(t.total), 0) as totalTokens,
       MAX(a.last_seen_at) as lastActive
     FROM agents a
     LEFT JOIN (
       SELECT agent_id,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns WHERE ts >= ? GROUP BY agent_id
     ) t ON a.agent_id = t.agent_id
     WHERE a.cwd IS NOT NULL
     GROUP BY a.cwd
     ORDER BY lastActive DESC NULLS LAST`
  ).all(since ?? "");
}

// ===== MCP / Skill usage from the recorded tool-event stream =====
// events.tokens holds a chars/4 estimate of each tool call's input + result
// payload — the context those calls actually injected into the conversation.

export interface McpUsageStat {
  server: string;
  calls: number;
  tokens: number;
  tools: { tool: string; calls: number; tokens: number }[];
}

export function getMcpUsage(db: Database, since: string): McpUsageStat[] {
  const rows = db.query<{ detail: string; calls: number; tokens: number }, [string]>(
    `SELECT detail, COUNT(*) as calls, SUM(tokens) as tokens
     FROM events
     WHERE kind = 'tool' AND detail LIKE 'mcp\\_\\_%' ESCAPE '\\' AND ts >= ?
     GROUP BY detail`
  ).all(since);

  const byServer = new Map<string, McpUsageStat>();
  for (const r of rows) {
    // detail = "mcp__<server>__<tool>"
    const rest = r.detail.slice(5);
    const sep = rest.indexOf("__");
    const server = sep === -1 ? rest : rest.slice(0, sep);
    const tool = sep === -1 ? "(unknown)" : rest.slice(sep + 2);
    const entry = byServer.get(server) ?? { server, calls: 0, tokens: 0, tools: [] };
    entry.calls += r.calls;
    entry.tokens += r.tokens ?? 0;
    entry.tools.push({ tool, calls: r.calls, tokens: r.tokens ?? 0 });
    byServer.set(server, entry);
  }
  return [...byServer.values()]
    .map(s => ({ ...s, tools: s.tools.sort((a, b) => b.tokens - a.tokens) }))
    .sort((a, b) => b.tokens - a.tokens);
}

export interface SkillUsageStat {
  skill: string;
  calls: number;
  tokens: number;
}

export function getSkillUsage(db: Database, since: string): SkillUsageStat[] {
  return db.query<SkillUsageStat, [string]>(
    `SELECT extra as skill, COUNT(*) as calls, SUM(tokens) as tokens
     FROM events
     WHERE kind = 'tool' AND detail = 'Skill' AND extra IS NOT NULL AND ts >= ?
     GROUP BY extra
     ORDER BY tokens DESC`
  ).all(since);
}

export function getCacheHitRate(db: Database, sinceDate?: string): number {
  const where = sinceDate ? `WHERE ts >= '${sinceDate}'` : "";
  const row = db.query<{ cr: number; total: number }, []>(
    `SELECT SUM(cache_read) as cr,
            SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read) as total
     FROM turns ${where}`
  ).get();
  if (!row || !row.total) return 0;
  return Math.round((row.cr / row.total) * 100);
}

export function getTopTurns(db: Database, limit = 10): {
  agent_id: string; ts: string; model: string | null; total: number;
}[] {
  return db.query<{ agent_id: string; ts: string; model: string | null; total: number }, [number]>(
    `SELECT agent_id, ts, model,
       (input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns ORDER BY total DESC LIMIT ?`
  ).all(limit);
}

export function getAgentCount(db: Database, sinceDate?: string): number {
  const where = sinceDate ? `WHERE started_at >= '${sinceDate}'` : "";
  const row = db.query<{ n: number }, []>(
    `SELECT COUNT(*) as n FROM agents ${where}`
  ).get();
  return row?.n ?? 0;
}

export function getRunCount(db: Database, sinceDate?: string): number {
  const where = sinceDate ? `WHERE started_at >= '${sinceDate}'` : "";
  const row = db.query<{ n: number }, []>(
    `SELECT COUNT(*) as n FROM runs ${where}`
  ).get();
  return row?.n ?? 0;
}
