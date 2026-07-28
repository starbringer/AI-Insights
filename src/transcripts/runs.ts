import type { Database } from "bun:sqlite";
import { upsertRun } from "./cache";
import type { ProviderFilter } from "./aggregate";

/**
 * Walk parent_agent_id chains and set agents.run_id (and turns.run_id) to the
 * root agent's id for every agent of this provider. Provider-agnostic — relies
 * only on parent_agent_id pointers populated by the provider's parser.
 */
export function resolveRunIdsForProvider(db: Database, provider: string): void {
  const agents = db.query<{ agent_id: string; parent_agent_id: string | null }, [string]>(
    `SELECT agent_id, parent_agent_id FROM agents WHERE provider = ?`
  ).all(provider);

  const parentMap = new Map<string, string | null>();
  for (const a of agents) parentMap.set(a.agent_id, a.parent_agent_id);

  const rootOf = new Map<string, string>();
  function findRoot(id: string, seen: Set<string>): string {
    if (rootOf.has(id)) return rootOf.get(id) as string;
    if (seen.has(id)) return id; // cycle guard
    seen.add(id);
    const parent = parentMap.get(id);
    if (!parent || !parentMap.has(parent)) {
      rootOf.set(id, id);
      return id;
    }
    const root = findRoot(parent, seen);
    rootOf.set(id, root);
    return root;
  }

  const updateAgent = db.prepare(`UPDATE agents SET run_id = ? WHERE agent_id = ?`);
  const updateTurns = db.prepare(`UPDATE turns SET run_id = ? WHERE agent_id = ?`);

  db.transaction(() => {
    for (const a of agents) {
      const root = findRoot(a.agent_id, new Set());
      updateAgent.run(root, a.agent_id);
      updateTurns.run(root, a.agent_id);
    }
  })();
}

/**
 * Recompute each agent's turn_count and last_seen_at from the authoritative
 * turns table.
 *
 * The incremental parser only sees each newly-parsed byte range and upsertAgent
 * overwrites (not accumulates) these columns, so:
 *   - turn_count drifts to just the last chunk's count (often 0);
 *   - last_seen_at gets nulled when the newest bytes are timestamp-less records
 *     (Claude Code appends `ai-title` / `mode` / `summary` lines after the last
 *     assistant turn), which then sorts the run to the bottom of the Runs page
 *     (ORDER BY last_seen_at DESC NULLS LAST).
 *
 * Deriving both from the turns table is exact and self-healing on every
 * recompute. last_seen_at falls back to the stored value when an agent has no
 * turns yet. Must run before refreshRuns so the run roll-up sees correct
 * per-agent values.
 */
export function recomputeAgentActivity(db: Database, provider: string): void {
  db.run(
    `UPDATE agents
       SET turn_count = COALESCE(
             (SELECT COUNT(*) FROM turns WHERE turns.agent_id = agents.agent_id), 0),
           last_seen_at = COALESCE(
             (SELECT MAX(ts) FROM turns WHERE turns.agent_id = agents.agent_id), last_seen_at)
     WHERE provider = ?`,
    [provider]
  );
}

/**
 * For each distinct run_id of this provider, aggregate data across its agents
 * and upsert a corresponding row in the runs table.
 */
export function refreshRuns(db: Database, provider: string): void {
  const rows = db.query<{
    run_id: string;
    cwd: string | null;
    project_flat: string | null;
    title: string | null;
    started_at: string | null;
    last_seen_at: string | null;
    agent_count: number;
    turn_count: number;
  }, [string]>(
    `SELECT
       r.run_id,
       root.cwd AS cwd,
       root.project_flat AS project_flat,
       root.title AS title,
       MIN(a.started_at) AS started_at,
       MAX(a.last_seen_at) AS last_seen_at,
       COUNT(*) AS agent_count,
       SUM(a.turn_count) AS turn_count
     FROM agents a
     JOIN (
       SELECT DISTINCT run_id FROM agents WHERE provider = ?
     ) r ON a.run_id = r.run_id
     JOIN agents root ON root.agent_id = r.run_id
     GROUP BY r.run_id`
  ).all(provider);

  db.transaction(() => {
    for (const row of rows) {
      upsertRun(db, {
        run_id: row.run_id,
        provider,
        project_flat: row.project_flat,
        cwd: row.cwd,
        title: row.title,
        started_at: row.started_at,
        last_seen_at: row.last_seen_at,
        agent_count: row.agent_count,
        turn_count: row.turn_count ?? 0,
      });
    }
  })();
}

// ===== Read-side helpers used by the API =====

export interface RunSummary {
  run_id: string;
  provider: string;
  title: string | null;
  cwd: string | null;
  project_flat: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  agent_count: number;
  turn_count: number;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export function listRuns(db: Database, opts: {
  limit?: number; offset?: number; project?: string; search?: string; provider?: ProviderFilter;
} = {}): { rows: RunSummary[]; total: number } {
  const { limit = 50, offset = 0, project, search, provider } = opts;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (provider) { conditions.push("r.provider = ?"); params.push(provider); }
  if (project) { conditions.push("r.cwd = ?"); params.push(project); }
  if (search) { conditions.push("(r.title LIKE ? OR r.cwd LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const allParams = [...params, limit, offset];

  const countRow = db.query(
    `SELECT COUNT(*) as n FROM runs r ${where}`
  ).get(...params) as { n: number } | null;

  const rows = db.query(
    `SELECT
       r.run_id, r.provider, r.title, r.cwd, r.project_flat,
       r.started_at, r.last_seen_at, r.agent_count, r.turn_count,
       COALESCE(t.input, 0)  as input,
       COALESCE(t.cw5m, 0)   as cacheCreate5m,
       COALESCE(t.cw1h, 0)   as cacheCreate1h,
       COALESCE(t.cr, 0)     as cacheRead,
       COALESCE(t.out, 0)    as output,
       COALESCE(t.total, 0)  as total
     FROM runs r
     LEFT JOIN (
       SELECT run_id,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cw5m,
         SUM(cache_create_1h) as cw1h,
         SUM(cache_read)      as cr,
         SUM(output_tokens)   as out,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns GROUP BY run_id
     ) t ON r.run_id = t.run_id
     ${where}
     ORDER BY r.last_seen_at DESC NULLS LAST
     LIMIT ? OFFSET ?`
  ).all(...allParams) as RunSummary[];

  return { rows, total: countRow?.n ?? 0 };
}

export interface AgentSummary {
  agent_id: string;
  provider: string;
  run_id: string;
  is_subagent: number;
  parent_agent_id: string | null;
  parent_turn_index: number | null;
  agent_type: string | null;
  description: string | null;
  cwd: string | null;
  title: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  turn_count: number;
  model: string | null;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface RunDetail {
  run: {
    run_id: string;
    provider: string;
    title: string | null;
    cwd: string | null;
    project_flat: string | null;
    started_at: string | null;
    last_seen_at: string | null;
    agent_count: number;
    turn_count: number;
  };
  agents: AgentSummary[];
}

export function loadRun(db: Database, runId: string): RunDetail | null {
  const run = db.query<RunDetail["run"], [string]>(
    `SELECT run_id, provider, title, cwd, project_flat, started_at, last_seen_at, agent_count, turn_count
     FROM runs WHERE run_id = ?`
  ).get(runId);
  if (!run) return null;

  const agents = db.query<AgentSummary, [string]>(
    `SELECT
       a.agent_id, a.provider, a.run_id, a.is_subagent, a.parent_agent_id, a.parent_turn_index,
       a.agent_type, a.description, a.cwd, a.title, a.started_at, a.last_seen_at, a.turn_count,
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
         MAX(model)           as model,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cw5m,
         SUM(cache_create_1h) as cw1h,
         SUM(cache_read)      as cr,
         SUM(output_tokens)   as out,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns GROUP BY agent_id
     ) t ON a.agent_id = t.agent_id
     WHERE a.run_id = ?
     ORDER BY
       a.parent_agent_id IS NOT NULL,
       COALESCE(a.parent_turn_index, 9999),
       a.started_at`
  ).all(runId);

  return { run, agents };
}

export function getActiveRuns(db: Database, windowMs = 5 * 60_000, provider?: ProviderFilter): number {
  const params: (string | number)[] = [new Date(Date.now() - windowMs).toISOString()];
  if (provider) params.push(provider);
  const row = db.query<{ n: number }, (string | number)[]>(
    `SELECT COUNT(DISTINCT run_id) as n FROM turns WHERE ts >= ?${provider ? " AND provider = ?" : ""}`
  ).get(...params);
  return row?.n ?? 0;
}

export interface TopRunStat {
  run_id: string;
  title: string | null;
  cwd: string | null;
  agent_count: number;
  turn_count: number;
  last_seen_at: string | null;
  model: string | null;
  input: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  total: number;
}

export function getTopRuns(db: Database, limit = 10, since?: string, provider?: ProviderFilter): TopRunStat[] {
  // Empty `since` compares <= every ISO timestamp, i.e. no filter.
  const params: (string | number)[] = [since ?? ""];
  if (provider) params.push(provider);
  params.push(limit);
  return db.query<TopRunStat, (string | number)[]>(
    `SELECT
       r.run_id, r.title, r.cwd, r.last_seen_at, r.agent_count, r.turn_count,
       t.model, t.input, t.cacheCreate5m, t.cacheCreate1h, t.cacheRead, t.output, t.total
     FROM runs r
     INNER JOIN (
       SELECT run_id,
         MAX(model)           as model,
         SUM(input_tokens)    as input,
         SUM(cache_create_5m) as cacheCreate5m,
         SUM(cache_create_1h) as cacheCreate1h,
         SUM(cache_read)      as cacheRead,
         SUM(output_tokens)   as output,
         SUM(input_tokens + cache_create_5m + cache_create_1h + cache_read + output_tokens) as total
       FROM turns
       WHERE ts >= ?${provider ? " AND provider = ?" : ""}
       GROUP BY run_id
     ) t ON r.run_id = t.run_id
     ORDER BY t.total DESC
     LIMIT ?`
  ).all(...params);
}
