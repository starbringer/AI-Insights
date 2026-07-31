import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { runKey, resolveRunKey, backfillRunKeys } from "./runKey";

// The whole point of a derived key is that a user can write it down and have it
// still mean the same run after the cache is thrown away and rebuilt. These
// tests pin that property and the lookup rules that depend on it.

describe("runKey", () => {
  test("is deterministic — the same inputs always produce the same key", () => {
    const a = runKey("claude-code", "3f9c1e22-aa10-4f7b-9d0e-11c2b8ff0011");
    const b = runKey("claude-code", "3f9c1e22-aa10-4f7b-9d0e-11c2b8ff0011");
    expect(a).toBe(b);
    // This is the guarantee that survives a SCHEMA_VERSION bump: nothing about
    // the key comes from database state.
    expect(a).toMatch(/^r-[0-9a-f]{12}$/);
  });

  test("the same native id under two providers yields different keys", () => {
    // Session ids are only unique within a tool, so the provider has to be part
    // of the hash or a Copilot run could shadow a Claude Code one.
    expect(runKey("claude-code", "session-1")).not.toBe(runKey("opencode", "session-1"));
  });

  test("field boundaries cannot be forged by concatenation", () => {
    // ("ab","cd") and ("a","bcd") must not collide.
    expect(runKey("ab", "cd")).not.toBe(runKey("a", "bcd"));
  });
});

function seedRuns(rows: { run_id: string; provider: string }[]): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE runs (run_id TEXT PRIMARY KEY, provider TEXT, run_key TEXT)`);
  for (const r of rows) {
    db.run(`INSERT INTO runs VALUES (?,?,NULL)`, [r.run_id, r.provider]);
  }
  for (const provider of new Set(rows.map(r => r.provider))) backfillRunKeys(db, provider);
  return db;
}

describe("backfillRunKeys", () => {
  test("fills every run of the provider and leaves others alone", () => {
    const db = seedRuns([
      { run_id: "s1", provider: "claude-code" },
      { run_id: "s2", provider: "other" },
    ]);
    const rows = db.query<{ run_id: string; run_key: string }, []>(
      `SELECT run_id, run_key FROM runs ORDER BY run_id`
    ).all();
    expect(rows[0]!.run_key).toBe(runKey("claude-code", "s1"));
    expect(rows[1]!.run_key).toBe(runKey("other", "s2"));
  });

  test("re-running produces identical keys (idempotent, no churn)", () => {
    const db = seedRuns([{ run_id: "s1", provider: "claude-code" }]);
    const first = db.query<{ run_key: string }, []>(`SELECT run_key FROM runs`).get()!.run_key;
    backfillRunKeys(db, "claude-code");
    expect(db.query<{ run_key: string }, []>(`SELECT run_key FROM runs`).get()!.run_key).toBe(first);
  });
});

describe("resolveRunKey", () => {
  const db = seedRuns([
    { run_id: "alpha", provider: "claude-code" },
    { run_id: "beta", provider: "claude-code" },
  ]);
  const alphaKey = runKey("claude-code", "alpha");

  test("resolves a full key", () => {
    expect(resolveRunKey(db, alphaKey).runId).toBe("alpha");
  });

  test("resolves a unique prefix, git-style", () => {
    expect(resolveRunKey(db, alphaKey.slice(0, 6)).runId).toBe("alpha");
  });

  test("accepts a bare prefix without the r- marker", () => {
    expect(resolveRunKey(db, alphaKey.slice(2, 8)).runId).toBe("alpha");
  });

  test("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(resolveRunKey(db, `  ${alphaKey.toUpperCase()} `).runId).toBe("alpha");
  });

  test("falls back to the provider's native run id", () => {
    // Anything copied out of a transcript path or an older client still works.
    expect(resolveRunKey(db, "beta").runId).toBe("beta");
  });

  test("an ambiguous prefix names the candidates instead of guessing", () => {
    // A hash collision is astronomically unlikely, but a SHORT prefix colliding
    // is not — and silently picking one would compare the wrong run.
    const ambiguous = seedRuns([
      { run_id: "x", provider: "p" },
      { run_id: "y", provider: "p" },
    ]);
    // Hand-set two keys that share a prefix, which is what a short lookup hits.
    ambiguous.run(`UPDATE runs SET run_key = 'r-abcd0000aaaa' WHERE run_id = 'x'`);
    ambiguous.run(`UPDATE runs SET run_key = 'r-abcd1111bbbb' WHERE run_id = 'y'`);

    expect(() => resolveRunKey(ambiguous, "r-abcd")).toThrow(/ambiguous/);
  });

  test("an unknown id explains the format and the retention caveat", () => {
    // The most common cause of "not found" is that the run aged out, so the
    // error has to say so rather than implying the id was wrong.
    expect(() => resolveRunKey(db, "r-ffffffffffff")).toThrow(/no run matches/);
    expect(() => resolveRunKey(db, "r-ffffffffffff")).toThrow(/retention/);
  });

  test("an empty id is rejected outright", () => {
    expect(() => resolveRunKey(db, "   ")).toThrow(/empty/);
  });

  test("the provider filter narrows the search", () => {
    expect(() => resolveRunKey(db, alphaKey, "other-provider")).toThrow(/no run matches/);
    expect(resolveRunKey(db, alphaKey, "claude-code").runId).toBe("alpha");
  });
});
