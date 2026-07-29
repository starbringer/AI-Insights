import { readFileSync, writeFileSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { RETENTION_PATH } from "./paths";
import { localMidnightIso, rangeDays, type RangeKey } from "./transcripts/aggregate";

// ============================================================================
// Data retention.
//
// This app is a cache over transcripts that live on disk elsewhere, so it keeps
// only a rolling window of parsed records. The window is user-configurable:
// `retentionDays` (default 30) is the number of CALENDAR days kept, counting
// today. Everything older is deleted from the SQLite cache on a sweep.
//
// The setting drives three things, and they must not drift apart:
//   1. what gets pruned (below),
//   2. how far back every "window" query looks (retentionCutoffIso),
//   3. which time ranges the dashboard and MCP tools offer (retentionRange).
// ============================================================================

export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

interface RetentionConfig {
  retentionDays: number;
}

// Memoized, but keyed on the file's mtime: the dashboard and the stdio MCP
// server are separate processes over one data dir, and only one of them writes.
// Without the mtime check a long-lived stdio server would keep clamping ranges
// to whatever the window was when it started.
let _cache: RetentionConfig | null = null;
let _cacheMtimeMs = -1;

/**
 * Coerce anything to a usable day count, clamped to the supported bounds.
 * A missing value means "not configured" and yields the default — only a real
 * number that is merely out of bounds gets clamped to the nearest limit.
 */
export function clampRetentionDays(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_RETENTION_DAYS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.trunc(n)));
}

export function getRetentionDays(): number {
  const mtimeMs = statSync(RETENTION_PATH, { throwIfNoEntry: false })?.mtimeMs ?? -1;
  if (_cache && mtimeMs === _cacheMtimeMs) return _cache.retentionDays;

  let days = DEFAULT_RETENTION_DAYS;
  if (mtimeMs !== -1) {
    try {
      const parsed = JSON.parse(readFileSync(RETENTION_PATH, "utf-8")) as Partial<RetentionConfig>;
      days = clampRetentionDays(parsed.retentionDays ?? DEFAULT_RETENTION_DAYS);
    } catch { /* unreadable or corrupt — fall back to the default */ }
  }
  _cache = { retentionDays: days };
  _cacheMtimeMs = mtimeMs;
  return days;
}

/** Persist a new window. Returns the value actually stored (clamped). */
export function setRetentionDays(raw: unknown): number {
  const days = clampRetentionDays(raw);
  writeFileSync(RETENTION_PATH, JSON.stringify({ retentionDays: days } satisfies RetentionConfig, null, 2));
  _cache = { retentionDays: days };
  _cacheMtimeMs = statSync(RETENTION_PATH, { throwIfNoEntry: false })?.mtimeMs ?? -1;
  return days;
}

/** The widest range the UI and the MCP tools may ask for. */
export function retentionRange(): RangeKey {
  return `${getRetentionDays()}d`;
}

/**
 * Oldest timestamp still kept. Anchored to local midnight so the window covers
 * whole calendar days — "30 days" means today plus the 29 before it, exactly
 * what the `30d` chart range shows.
 *
 * Never newer than 24 hours ago: the `24h` range is offered at every setting,
 * and at a 1-day retention a bare midnight anchor would empty half of that
 * chart every morning.
 */
export function retentionCutoffIso(window = getRetentionDays()): string {
  const midnight = localMidnightIso(window - 1);
  const rolling24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  return midnight < rolling24h ? midnight : rolling24h;
}

/**
 * Narrow a requested range to what retention can actually answer.
 * `window` is injectable so the rule can be tested without touching the
 * on-disk setting.
 */
export function clampRange(range: RangeKey, window = getRetentionDays()): RangeKey {
  const days = rangeDays(range);
  if (days === null) return range;                    // 1h / 24h always fit
  return `${Math.min(days, window)}d`;
}

/** Clamp a raw day count (e.g. get_daily_usage's `days`) to the window. */
export function clampDays(days: number, window = getRetentionDays()): number {
  if (!Number.isFinite(days)) return window;
  return Math.min(Math.max(Math.trunc(days), 1), window);
}

export interface PruneResult {
  cutoff: string;
  turns: number;
  events: number;
  agents: number;
  runs: number;
}

function changesOf(result: unknown): number {
  return typeof (result as { changes?: number } | undefined)?.changes === "number"
    ? (result as { changes: number }).changes
    : 0;
}

/**
 * Delete everything older than the retention window.
 *
 * Order matters: turns and events go first, then the agents left with nothing
 * inside them, then the runs left with no agents. An agent that still has turns
 * inside the window survives even if it STARTED before the cutoff, so a
 * long-running session is trimmed rather than dropped.
 *
 * The `files` table is deliberately untouched: it holds each transcript's
 * parsed byte offset, and clearing a row would make the next scan re-read the
 * whole file and re-insert the very rows this just deleted. Raising the
 * retention setting is what resets it (see resetIngestState).
 */
export function pruneOldData(db: Database): PruneResult {
  const cutoff = retentionCutoffIso();
  const result: PruneResult = { cutoff, turns: 0, events: 0, agents: 0, runs: 0 };

  db.transaction(() => {
    result.turns  = changesOf(db.run(`DELETE FROM turns  WHERE ts < ?`, [cutoff]));
    result.events = changesOf(db.run(`DELETE FROM events WHERE ts < ?`, [cutoff]));
    // Timestamp-less agents are left alone: they are anomalies, not aged-out
    // rows, and `NULL < cutoff` would silently sweep them up.
    result.agents = changesOf(db.run(
      `DELETE FROM agents
        WHERE agent_id NOT IN (SELECT agent_id FROM turns)
          AND COALESCE(last_seen_at, started_at) IS NOT NULL
          AND COALESCE(last_seen_at, started_at) < ?`,
      [cutoff],
    ));
    result.runs = changesOf(db.run(
      `DELETE FROM runs WHERE run_id NOT IN (SELECT run_id FROM agents)`,
    ));
  })();

  return result;
}

/**
 * Forget how far each transcript was parsed, so the next scan re-reads every
 * file from the start. Used when the window is WIDENED: the older turns were
 * deleted, but the transcripts they came from are still on disk, so a full
 * re-scan restores as much history as the new window allows.
 */
export function resetIngestState(db: Database): void {
  db.run(`DELETE FROM files`);
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Prune now, then hourly. The periodic pass matters because the cutoff moves at
 * every local midnight — a server left running for a week must not accumulate a
 * week of over-retention data.
 */
export function startRetentionSweeper(db: Database): void {
  const sweep = () => {
    try {
      const r = pruneOldData(db);
      if (r.turns || r.events || r.agents || r.runs) {
        console.log(`[retention] pruned ${r.turns} turns, ${r.events} events, ${r.agents} agents, ${r.runs} runs older than ${r.cutoff} (keeping ${getRetentionDays()} days)`);
      }
    } catch (e) {
      console.error("[retention] sweep failed:", e);
    }
  };
  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Never hold the process open just to run a sweep.
  timer.unref?.();
}
