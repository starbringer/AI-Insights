import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { configAdapterFor } from "./index";
import { PATH_COLLATE } from "../paths";

// ============================================================================
// Harness fingerprint log.
//
// Harness configuration is read live from disk, which is right for every other
// feature and fatal for one: once you edit CLAUDE.md, the version a past run
// actually ran under is gone. A before/after comparison could then show that
// cost fell but never say *because what*.
//
// So the app keeps an append-only log of what the harness looked like. Rows hold
// component hashes and token counts only — never file contents — and one is
// written only when the fingerprint changes, so a stable setup adds nothing
// beyond the first row.
//
// Provider-agnostic: everything here goes through ToolConfigAdapter's neutral
// shapes and is guarded by capabilities(), so an adapter that implements less
// simply produces fewer sections and the diff degrades gracefully.
// ============================================================================

/** One tracked piece of the harness. `tokens` is null when the shape has no size. */
export interface ComponentFingerprint {
  type: "instructions" | "skill" | "command" | "hook" | "mcp" | "permissions" | "settings";
  id: string;
  scope?: string;
  tokens: number | null;
  hash: string;
  /** Extra facts worth showing in a diff, e.g. an MCP server's tool count. */
  meta?: Record<string, string | number>;
}

export interface HarnessSnapshot {
  provider: string;
  project: string | null;
  capturedAt: string;
  fingerprint: string;
  components: ComponentFingerprint[];
}

export interface HarnessChange {
  type: ComponentFingerprint["type"];
  id: string;
  scope?: string;
  change: "added" | "removed" | "modified";
  tokensBefore: number | null;
  tokensAfter: number | null;
  tokensDelta: number | null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Stable hash of a component list: order must not matter. */
function fingerprintOf(components: ComponentFingerprint[]): string {
  const canonical = components
    .map(c => `${c.type} ${c.id} ${c.scope ?? ""} ${c.tokens ?? ""} ${c.hash}`)
    .sort()
    .join("\n");
  return sha(canonical);
}

/**
 * Read the current harness through the provider's config adapter.
 *
 * `project` scopes the sections that have per-project layers (instructions,
 * permissions, settings); pass null for user scope only.
 */
export function captureHarness(
  db: Database, providerId: string, project?: string | null,
): HarnessSnapshot | null {
  const adapter = configAdapterFor(providerId);
  if (!adapter) return null;
  const caps = adapter.capabilities();
  const components: ComponentFingerprint[] = [];

  if (caps.instructions && adapter.listInstructions) {
    for (const f of adapter.listInstructions(db).files) {
      if (!f.exists) continue;
      // Hash the content, not the token count: two different edits can land on
      // the same count, and a diff that missed those would be worse than none.
      const body = adapter.readInstructionFile?.(db, f.path)?.content ?? "";
      components.push({
        type: "instructions", id: f.path, scope: f.scope,
        tokens: f.tokens, hash: sha(body),
      });
    }
  }

  if (caps.skills && adapter.listSkills) {
    for (const s of adapter.listSkills(db)) {
      components.push({
        type: "skill", id: s.name, scope: s.source,
        tokens: s.tokens, hash: sha(s.content),
      });
    }
  }

  if (caps.commands && adapter.listCommands) {
    for (const c of adapter.listCommands(db)) {
      components.push({
        type: "command", id: c.name, scope: c.source,
        tokens: c.tokens, hash: sha(c.content),
      });
    }
  }

  if (caps.hooks && adapter.listHooks) {
    for (const h of adapter.listHooks(db).entries) {
      const shape = JSON.stringify({ event: h.event, matcher: h.matcher, actions: h.actions });
      components.push({
        type: "hook", id: `${h.event}:${h.matcher ?? "*"}:${h.matcherIndex}`, scope: h.level,
        tokens: null, hash: sha(shape),
      });
    }
  }

  if (caps.mcp && adapter.mcpServerDefs) {
    // Definitions only, never a probe. Probing spawns every stdio server, and its
    // cache is per-process, so a probe-based fingerprint would be both expensive
    // and unstable — the same config could hash differently from two processes
    // and show up as a phantom "MCP changed".
    //
    // What that gives up is schema token counts. That is the right trade: the
    // token cost of MCP is already measured from the recorded event stream
    // (getRunComponents, get_mcp_usage), which beats a schema-size estimate.
    for (const s of adapter.mcpServerDefs()) {
      components.push({
        type: "mcp", id: s.name, scope: s.scope, tokens: null,
        hash: sha(JSON.stringify({ type: s.type ?? null, command: s.command ?? null, source: s.source })),
        meta: { transport: s.type ?? "unknown" },
      });
    }
  }

  if (caps.permissions && adapter.permissionModel) {
    const model = adapter.permissionModel(db, project ?? undefined);
    const rules = model.effective.map(r => `${r.effect} ${r.raw}`).sort().join("\n");
    components.push({
      type: "permissions", id: "effective", tokens: null, hash: sha(rules),
      meta: {
        allow: model.effective.filter(r => r.effect === "allow").length,
        deny: model.effective.filter(r => r.effect === "deny").length,
        ask: model.effective.filter(r => r.effect === "ask").length,
      },
    });
  }

  if (caps.effectiveConfig && adapter.effectiveConfig) {
    const model = adapter.effectiveConfig(db, project ?? undefined);
    for (const layer of model.layers) {
      if (!layer.exists) continue;
      components.push({
        type: "settings", id: layer.filePath, scope: layer.level,
        tokens: null, hash: sha(JSON.stringify(layer.raw)),
      });
    }
  }

  return {
    provider: providerId,
    project: project ?? null,
    capturedAt: new Date().toISOString(),
    fingerprint: fingerprintOf(components),
    components,
  };
}

/**
 * Persist a snapshot, but only when it differs from the latest stored one.
 * Returns true when a row was written.
 */
export function recordSnapshot(db: Database, snap: HarnessSnapshot): boolean {
  const latest = db.query<{ fingerprint: string }, [string, string | null]>(
    `SELECT fingerprint FROM harness_snapshots
      WHERE provider = ? AND project IS ?
      ORDER BY captured_at DESC LIMIT 1`
  ).get(snap.provider, snap.project);

  if (latest?.fingerprint === snap.fingerprint) return false;

  db.run(
    `INSERT INTO harness_snapshots(provider, project, captured_at, fingerprint, payload)
     VALUES(?,?,?,?,?)`,
    [snap.provider, snap.project, snap.capturedAt, snap.fingerprint, JSON.stringify(snap.components)],
  );
  return true;
}

interface SnapshotRow {
  captured_at: string;
  fingerprint: string;
  payload: string;
  project: string | null;
  provider: string;
}

/**
 * Row → snapshot, or null if the payload will not parse.
 *
 * Degrading rather than throwing: the harness diff is a supporting detail that
 * every caller already treats as optional, so one unreadable row must not fail
 * the cost comparison around it — that part does not depend on snapshots at all.
 */
function hydrate(row: SnapshotRow): HarnessSnapshot | null {
  let components: ComponentFingerprint[];
  try {
    components = JSON.parse(row.payload) as ComponentFingerprint[];
  } catch {
    return null;
  }
  if (!Array.isArray(components)) return null;
  return {
    provider: row.provider,
    project: row.project,
    capturedAt: row.captured_at,
    fingerprint: row.fingerprint,
    components,
  };
}

/**
 * The snapshot in effect at a moment: the newest one captured at or before it.
 *
 * Falls back to the oldest snapshot on record when the timestamp predates every
 * capture — a run from before the app started logging has no true snapshot, and
 * saying so is the caller's job (see `exact`).
 */
export function snapshotAt(
  db: Database, provider: string, at: string, project?: string | null,
): { snapshot: HarnessSnapshot; exact: boolean } | null {
  const scope = projectScope(project);

  const before = db.query<SnapshotRow, string[]>(
    `SELECT provider, project, captured_at, fingerprint, payload FROM harness_snapshots
      WHERE provider = ? AND captured_at <= ?${scope.clause}
      ORDER BY captured_at DESC LIMIT 1`
  ).get(provider, at, ...scope.params);

  const hydratedBefore = before ? hydrate(before) : null;
  if (hydratedBefore) return { snapshot: hydratedBefore, exact: true };

  const oldest = db.query<SnapshotRow, string[]>(
    `SELECT provider, project, captured_at, fingerprint, payload FROM harness_snapshots
      WHERE provider = ?${scope.clause}
      ORDER BY captured_at ASC LIMIT 1`
  ).get(provider, ...scope.params);

  const hydratedOldest = oldest ? hydrate(oldest) : null;
  return hydratedOldest ? { snapshot: hydratedOldest, exact: false } : null;
}

/**
 * Project-scope predicate for a snapshot lookup.
 *
 * Case-folded on Windows, for the same reason the comparison caveats are: the
 * cwd recorded on a run carries whatever drive-letter case the session was
 * launched with, so a plain `=` against the captured project string misses and
 * the harness attribution silently degrades to "no snapshot covers this run".
 *
 * `undefined` means "any scope", `null` means user scope specifically.
 */
function projectScope(project?: string | null): { clause: string; params: string[] } {
  if (project === undefined) return { clause: "", params: [] };
  if (project === null) return { clause: " AND project IS NULL", params: [] };
  return { clause: ` AND project = ?${PATH_COLLATE}`, params: [project] };
}

/** Every readable snapshot in a window, oldest first. */
export function snapshotsBetween(
  db: Database, provider: string, fromIso: string, untilIso: string,
): HarnessSnapshot[] {
  return db.query<SnapshotRow, [string, string, string]>(
    `SELECT provider, project, captured_at, fingerprint, payload FROM harness_snapshots
      WHERE provider = ? AND captured_at >= ? AND captured_at < ?
      ORDER BY captured_at ASC`
  ).all(provider, fromIso, untilIso)
    .map(hydrate)
    .filter((s): s is HarnessSnapshot => s !== null);
}

const keyOf = (c: ComponentFingerprint) => `${c.type} ${c.id}`;

/** What changed between two snapshots. Empty when the harness held still. */
export function diffSnapshots(before: HarnessSnapshot, after: HarnessSnapshot): HarnessChange[] {
  const b = new Map(before.components.map(c => [keyOf(c), c]));
  const a = new Map(after.components.map(c => [keyOf(c), c]));
  const changes: HarnessChange[] = [];

  for (const [key, ac] of a) {
    const bc = b.get(key);
    if (!bc) {
      changes.push({
        type: ac.type, id: ac.id, scope: ac.scope, change: "added",
        tokensBefore: null, tokensAfter: ac.tokens, tokensDelta: ac.tokens,
      });
    } else if (bc.hash !== ac.hash || bc.tokens !== ac.tokens) {
      changes.push({
        type: ac.type, id: ac.id, scope: ac.scope, change: "modified",
        tokensBefore: bc.tokens, tokensAfter: ac.tokens,
        tokensDelta: bc.tokens !== null && ac.tokens !== null ? ac.tokens - bc.tokens : null,
      });
    }
  }
  for (const [key, bc] of b) {
    if (a.has(key)) continue;
    changes.push({
      type: bc.type, id: bc.id, scope: bc.scope, change: "removed",
      tokensBefore: bc.tokens, tokensAfter: null,
      tokensDelta: bc.tokens === null ? null : -bc.tokens,
    });
  }

  // Biggest token movement first: that is the one most likely to explain a
  // cost delta, and the list is read top-down.
  return changes.sort((x, y) => Math.abs(y.tokensDelta ?? 0) - Math.abs(x.tokensDelta ?? 0));
}

/**
 * A timeline of harness edits: each snapshot diffed against the one before it.
 * This is what lets a comparison propose its own split point instead of making
 * the user remember when they made the change.
 */
export function harnessChangeLog(
  db: Database, provider: string, fromIso: string, untilIso: string,
): { capturedAt: string; project: string | null; changes: HarnessChange[] }[] {
  const snaps = snapshotsBetween(db, provider, fromIso, untilIso);
  const out: { capturedAt: string; project: string | null; changes: HarnessChange[] }[] = [];

  // Group by project scope — a project's snapshots form their own series.
  const byProject = new Map<string, HarnessSnapshot[]>();
  for (const s of snaps) {
    const k = s.project ?? "";
    byProject.set(k, [...(byProject.get(k) ?? []), s]);
  }

  for (const [, series] of byProject) {
    // Seed with the snapshot in effect just before the window, so an edit made
    // at the very start of the window still shows up as a change.
    const scope = projectScope(series[0]!.project);
    const priorRow = db.query<SnapshotRow, string[]>(
      `SELECT provider, project, captured_at, fingerprint, payload FROM harness_snapshots
        WHERE provider = ? AND captured_at < ?${scope.clause}
        ORDER BY captured_at DESC LIMIT 1`
    ).get(provider, fromIso, ...scope.params);

    let prev = priorRow ? hydrate(priorRow) : null;
    for (const snap of series) {
      if (prev) {
        const changes = diffSnapshots(prev, snap);
        if (changes.length) out.push({ capturedAt: snap.capturedAt, project: snap.project, changes });
      }
      prev = snap;
    }
  }

  return out.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

// Snapshot pruning lives in retention.ts alongside the other sweeps: this module
// must not import that one, which reads the config adapters through us.

const CAPTURE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Snapshot user scope plus every project the provider knows about.
 *
 * Cheap in the common case: the fingerprint gate means an unchanged harness
 * writes nothing, and the MCP section reuses the probe cache.
 */
export function captureAll(db: Database, providerId: string): number {
  const adapter = configAdapterFor(providerId);
  if (!adapter) return 0;

  const scopes: (string | null)[] = [null];
  if (adapter.listProjects) {
    try { scopes.push(...adapter.listProjects(db)); } catch { /* keep user scope */ }
  }

  let written = 0;
  for (const project of scopes) {
    try {
      const snap = captureHarness(db, providerId, project);
      if (snap && recordSnapshot(db, snap)) written++;
    } catch (e) {
      console.error(`[harness] snapshot failed for ${providerId} ${project ?? "(user)"}:`, e);
    }
  }
  return written;
}

/**
 * Capture now, then every 15 minutes.
 *
 * The interval is the resolution of the change timeline: an edit is dated to the
 * next capture after it, so a comparison split at that timestamp attributes runs
 * to the right side. Finer would add rows without adding accuracy — token counts
 * come from measured API usage, not from when we noticed the file moved.
 */
export function startHarnessCapture(db: Database, providerIds: string[]): void {
  const capture = () => {
    for (const id of providerIds) {
      try { captureAll(db, id); } catch (e) { console.error("[harness] capture failed:", e); }
    }
  };
  capture();
  const timer = setInterval(capture, CAPTURE_INTERVAL_MS);
  timer.unref?.();
}
