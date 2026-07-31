import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { ProviderFilter } from "./aggregate";

// ============================================================================
// Provider-neutral run identifier.
//
// The comparison tools let a user quote a run id back to the app days later
// ("compare r-9f3a1c2b7e04 against r-4d81ff02a9c6"), so the id has to outlive
// the database it was read from. cache.db does not qualify: a SCHEMA_VERSION
// bump drops every table (db.ts) and the JSONL transcripts are re-parsed from
// scratch. An AUTOINCREMENT id or a UUID minted at insert time would come back
// different after that rebuild and silently point at the wrong run.
//
// So the key is *derived*, never assigned: hashing (provider, native run id)
// regenerates the identical string forever, from any machine, with no state to
// preserve. It is also provider-neutral by construction — a future Copilot or
// OpenCode adapter gets keys in the same namespace without agreeing on an id
// format, and the same native session id under two providers cannot collide.
// ============================================================================

/** Hex chars kept from the digest. 48 bits: ~0.002% collision odds at 100k runs. */
const KEY_HEX = 12;

/** Shortest accepted prefix. Below this almost any key is ambiguous. */
const MIN_PREFIX = 4;

const KEY_RE = new RegExp(`^r-[0-9a-f]{${MIN_PREFIX},${KEY_HEX}}$`);

/**
 * Stable public id for a run, e.g. "r-9f3a1c2b7e04".
 *
 * Hashing the JSON tuple rather than a concatenation keeps the two fields
 * unambiguous — ("ab", "cd") and ("a", "bcd") encode differently — without
 * relying on a separator character that a provider id might itself contain.
 */
export function runKey(provider: string, runId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([provider, runId])).digest("hex");
  return `r-${digest.slice(0, KEY_HEX)}`;
}

export interface ResolvedRun {
  runId: string;
  provider: string;
  runKey: string;
}

/**
 * Look up a run from anything a user might paste: a full key, any unique key
 * prefix of 4+ chars (git-style), or the provider's own native run id.
 *
 * Throws rather than returning null — every caller is a tool handler that turns
 * a throw into a readable error, and "not found" vs "ambiguous" need different
 * messages. `provider` narrows the search when a bare prefix hits two sources.
 */
export function resolveRunKey(db: Database, input: string, provider?: ProviderFilter): ResolvedRun {
  const raw = input.trim();
  if (!raw) throw new Error("run id is empty");

  // Accept a bare hex prefix ("9f3a") as well as the canonical "r-9f3a" form.
  const candidate = raw.toLowerCase();
  const keyForm = candidate.startsWith("r-") ? candidate : `r-${candidate}`;
  const provAnd = provider ? " AND provider = ?" : "";

  if (KEY_RE.test(keyForm)) {
    const params: string[] = [`${keyForm}%`];
    if (provider) params.push(provider);
    const hits = db.query<{ run_id: string; provider: string; run_key: string }, string[]>(
      `SELECT run_id, provider, run_key FROM runs WHERE run_key LIKE ?${provAnd} LIMIT 5`
    ).all(...params);

    if (hits.length === 1) {
      const h = hits[0]!;
      return { runId: h.run_id, provider: h.provider, runKey: h.run_key };
    }
    if (hits.length > 1) {
      throw new Error(
        `run id "${raw}" is ambiguous — matches ${hits.map(h => h.run_key).join(", ")}. ` +
        `Use more characters, or pass provider.`
      );
    }
  }

  // Fall back to the provider's native id so anything shown by an older client
  // (or copied out of a transcript path) still resolves.
  const nativeParams: string[] = [raw];
  if (provider) nativeParams.push(provider);
  const native = db.query<{ run_id: string; provider: string; run_key: string }, string[]>(
    `SELECT run_id, provider, run_key FROM runs WHERE run_id = ?${provAnd} LIMIT 2`
  ).all(...nativeParams);

  if (native.length === 1) {
    const h = native[0]!;
    return { runId: h.run_id, provider: h.provider, runKey: h.run_key };
  }
  if (native.length > 1) {
    throw new Error(`run id "${raw}" exists under more than one provider — pass provider to disambiguate.`);
  }

  throw new Error(
    `no run matches "${raw}". Run ids look like "r-9f3a1c2b7e04"; list_runs returns one per row. ` +
    `Note that runs older than the retention window are deleted.`
  );
}

/**
 * Backfill run_key for rows that lack one.
 *
 * Called from refreshRuns after the roll-up, so every provider gets keys with
 * no per-provider code. Keys never change for a given run, so this only ever
 * touches newly inserted rows.
 */
export function backfillRunKeys(db: Database, provider: string): void {
  const rows = db.query<{ run_id: string }, [string]>(
    `SELECT run_id FROM runs WHERE provider = ? AND (run_key IS NULL OR run_key = '')`
  ).all(provider);
  if (rows.length === 0) return;

  const update = db.prepare(`UPDATE runs SET run_key = ? WHERE run_id = ?`);
  db.transaction(() => {
    for (const r of rows) update.run(runKey(provider, r.run_id), r.run_id);
  })();
}
