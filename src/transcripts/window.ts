import { getRetentionDays, retentionCutoffIso } from "../retention";

// ============================================================================
// Explicit, end-bounded time windows.
//
// Every existing range ("1h", "24h", "30d") is anchored to now, which answers
// "what am I spending lately" but cannot express "the two weeks BEFORE the
// change" — the half of a before/after comparison that is not the present.
//
// The retention guard lives here rather than in each tool: a window is the only
// way to ask for a past period, so checking it at construction means no caller
// can accidentally report on data that was already deleted.
// ============================================================================

export interface WindowSpec {
  /** Start bound: ISO datetime, "YYYY-MM-DD", or a relative "7d" / "24h" (ago). */
  from?: string;
  /** End bound, same forms. Defaults to now. Exclusive. */
  until?: string;
}

export interface ResolvedWindow {
  fromIso: string;
  /** Exclusive upper bound, so adjacent windows tile without double counting. */
  untilIso: string;
  /** True when `from` predated the retention cutoff and was moved forward. */
  clamped: boolean;
  label: string;
  /** The window in days at resolve time, so warnings need no further lookups. */
  retentionDays: number;
}

/** Injectable retention facts, so the rules can be tested without touching disk. */
export interface WindowLimits {
  cutoffIso?: string;
  retentionDays?: number;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_RE = /^(\d{1,5})\s*(h|d)$/i;

/**
 * Parse one bound. `edge` decides how a bare date is widened: a start bound
 * means local midnight of that day, an end bound means local midnight of the
 * NEXT day, so `from: "2026-07-01", until: "2026-07-07"` covers all seven days
 * rather than stopping at the start of the 7th.
 */
function parseBound(raw: string, edge: "start" | "end"): string {
  const s = raw.trim();
  if (!s || s.toLowerCase() === "now") return new Date().toISOString();

  const rel = RELATIVE_RE.exec(s);
  if (rel) {
    const n = parseInt(rel[1]!, 10);
    const ms = rel[2]!.toLowerCase() === "h" ? n * 3600_000 : n * 24 * 3600_000;
    return new Date(Date.now() - ms).toISOString();
  }

  const dateOnly = DATE_ONLY_RE.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // Local, not UTC: timestamps are stored as UTC ISO strings, so treating a
    // bare date as UTC midnight would cut the day hours off for anyone outside
    // UTC — the same reasoning as localMidnightIso in aggregate.ts.
    const dt = new Date(Number(y), Number(m) - 1, Number(d) + (edge === "end" ? 1 : 0));
    if (Number.isNaN(dt.getTime())) throw new Error(`invalid date "${raw}"`);
    return dt.toISOString();
  }

  // A bare number is the likely typo for a relative offset, and Date() would
  // quietly read "7" as a month in 2001 — which then fails the retention check
  // with an error about a window nobody asked for.
  if (/^\d+$/.test(s)) {
    throw new Error(`"${raw}" is ambiguous — write "${s}d" for days or "${s}h" for hours.`);
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(
      `cannot read "${raw}" as a time. Use an ISO timestamp, a date ("2026-07-15"), ` +
      `or a relative offset ("7d", "24h").`
    );
  }
  return dt.toISOString();
}

/**
 * Build a window, refusing anything retention has already deleted.
 *
 * A window entirely older than the cutoff throws: reporting zeros for a period
 * whose data was pruned would read as "you spent nothing then", which is worse
 * than an error. A window that merely starts too early is clamped and flagged,
 * so the caller can warn while still answering.
 */
export function resolveWindow(
  spec: WindowSpec, label = "window", limits: WindowLimits = {},
): ResolvedWindow {
  if (!spec.from) throw new Error(`${label}: "from" is required`);

  const rawFrom = parseBound(spec.from, "start");
  const untilIso = spec.until ? parseBound(spec.until, "end") : new Date().toISOString();

  if (rawFrom >= untilIso) {
    throw new Error(`${label}: "from" (${rawFrom}) is not before "until" (${untilIso})`);
  }

  const retentionDays = limits.retentionDays ?? getRetentionDays();
  const cutoff = limits.cutoffIso ?? retentionCutoffIso(retentionDays);
  if (untilIso <= cutoff) {
    throw new Error(
      `${label} ends at ${untilIso}, but retention is set to ${retentionDays} days and ` +
      `everything before ${cutoff} has been deleted. Compare a more recent period, or raise ` +
      `the retention setting before the data you need ages out — it cannot be recovered afterwards.`
    );
  }

  const clamped = rawFrom < cutoff;
  return {
    fromIso: clamped ? cutoff : rawFrom,
    untilIso,
    clamped,
    label,
    retentionDays,
  };
}

/** Warning text for a clamped window, or null when it fitted. */
export function clampWarning(w: ResolvedWindow): string | null {
  if (!w.clamped) return null;
  return `${w.label} was trimmed to ${w.fromIso} — retention is ${w.retentionDays} days, ` +
    `so anything earlier is already deleted and is not counted below.`;
}
