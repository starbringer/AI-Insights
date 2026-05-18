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

export interface SessionSummary {
  session_id: string;
  title: string | null;
  cwd: string | null;
  project_flat: string | null;
  model: string | null;
  is_subagent: number;
  parent_session_id: string | null;
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

function daysBefore(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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

  // Cost estimate across models (use default model for simplicity in aggregate)
  const byModel = getModelStats(db, sinceDate);
  const totalCost = byModel.reduce((sum, m) => {
    const c = computeCost(m.model, m.input, m.output, m.cacheCreate5m, m.cacheCreate1h, m.cacheRead);
    return sum + c.total;
  }, 0);

  return { input, cacheCreate5m: cw5m, cacheCreate1h: cw1h, cacheRead: cr, output, total, totalCost };
}

export function getDailySeries(db: Database, days = 30): DailyStat[] {
  const since = daysBefore(days);
  return db.query<DailyStat, [string]>(
    `SELECT
       substr(ts, 1, 10) as date,
       SUM(input_tokens)    as input,
       SUM(cache_create_5m) as cacheCreate5m,
       SUM(cache_create_1h) as cacheCreate1h,
       SUM(cache_read)      as cacheRead,
       SUM(output_tokens)   as output,
       SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns WHERE ts >= ?
     GROUP BY substr(ts, 1, 10)
     ORDER BY date`
  ).all(since);
}

export function getModelStats(db: Database, sinceDate?: string): ModelStat[] {
  const where = sinceDate ? `WHERE ts >= '${sinceDate}'` : "";
  return db.query<ModelStat, []>(
    `SELECT
       COALESCE(model, 'unknown') as model,
       SUM(input_tokens)    as input,
       SUM(cache_create_5m) as cacheCreate5m,
       SUM(cache_create_1h) as cacheCreate1h,
       SUM(cache_read)      as cacheRead,
       SUM(output_tokens)   as output,
       SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns ${where}
     GROUP BY model
     ORDER BY total DESC`
  ).all();
}

export function getSessions(db: Database, opts: {
  limit?: number; offset?: number; project?: string; search?: string;
} = {}): { rows: SessionSummary[]; total: number } {
  const { limit = 50, offset = 0, project, search } = opts;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (project) { conditions.push("s.cwd = ?"); params.push(project); }
  if (search) { conditions.push("(s.title LIKE ? OR s.cwd LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const allParams = [...params, limit, offset];

  const countRow = db.query(
    `SELECT COUNT(*) as n FROM sessions s ${where}`
  ).get(...params) as { n: number } | null;

  const rows = db.query(
    `SELECT
       s.session_id, s.title, s.cwd, s.project_flat, s.is_subagent, s.parent_session_id,
       s.started_at, s.last_seen_at, s.turn_count,
       t.model,
       COALESCE(t.input, 0)  as input,
       COALESCE(t.cw5m, 0)   as cacheCreate5m,
       COALESCE(t.cw1h, 0)   as cacheCreate1h,
       COALESCE(t.cr, 0)     as cacheRead,
       COALESCE(t.out, 0)    as output,
       COALESCE(t.total, 0)  as total
     FROM sessions s
     LEFT JOIN (
       SELECT session_id,
         MAX(model) as model,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cw5m,
         SUM(cache_create_1h) as cw1h,
         SUM(cache_read)      as cr,
         SUM(output_tokens)   as out,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns GROUP BY session_id
     ) t ON s.session_id = t.session_id
     ${where}
     ORDER BY s.last_seen_at DESC NULLS LAST
     LIMIT ? OFFSET ?`
  ).all(...allParams) as SessionSummary[];

  return { rows, total: countRow?.n ?? 0 };
}

export function getProjects(db: Database): {
  cwd: string; sessionCount: number; totalTokens: number; lastActive: string | null;
}[] {
  return db.query<{
    cwd: string; sessionCount: number; totalTokens: number; lastActive: string | null;
  }, []>(
    `SELECT
       s.cwd,
       COUNT(DISTINCT s.session_id) as sessionCount,
       COALESCE(SUM(t.total), 0) as totalTokens,
       MAX(s.last_seen_at) as lastActive
     FROM sessions s
     LEFT JOIN (
       SELECT session_id,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns GROUP BY session_id
     ) t ON s.session_id = t.session_id
     WHERE s.cwd IS NOT NULL
     GROUP BY s.cwd
     ORDER BY lastActive DESC NULLS LAST`
  ).all();
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
  session_id: string; ts: string; model: string | null; total: number;
}[] {
  return db.query<{ session_id: string; ts: string; model: string | null; total: number }, [number]>(
    `SELECT session_id, ts, model,
       (input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
     FROM turns ORDER BY total DESC LIMIT ?`
  ).all(limit);
}

export interface TopSessionStat {
  session_id: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  turn_count: number;
  last_seen_at: string | null;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export function getTopSessions(db: Database, limit = 10): TopSessionStat[] {
  return db.query<TopSessionStat, [number]>(
    `SELECT
       s.session_id, s.title, s.cwd, s.last_seen_at, s.turn_count,
       t.model, t.input, t.cacheCreate5m, t.cacheCreate1h, t.cacheRead, t.output, t.total
     FROM sessions s
     INNER JOIN (
       SELECT session_id,
         MAX(model)           as model,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cacheCreate5m,
         SUM(cache_create_1h) as cacheCreate1h,
         SUM(cache_read)      as cacheRead,
         SUM(output_tokens)   as output,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns
       GROUP BY session_id
     ) t ON s.session_id = t.session_id
     ORDER BY t.total DESC
     LIMIT ?`
  ).all(limit);
}

export function getActiveSessions(db: Database, windowMs = 5 * 60_000): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db.query<{ n: number }, [string]>(
    "SELECT COUNT(DISTINCT session_id) as n FROM turns WHERE ts >= ?"
  ).get(since);
  return row?.n ?? 0;
}

export function getSessionCount(db: Database, sinceDate?: string): number {
  const where = sinceDate ? `WHERE started_at >= '${sinceDate}'` : "";
  const row = db.query<{ n: number }, []>(
    `SELECT COUNT(*) as n FROM sessions ${where}`
  ).get();
  return row?.n ?? 0;
}
