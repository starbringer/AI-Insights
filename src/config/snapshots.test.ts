import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import {
  diffSnapshots, harnessChangeLog, recordSnapshot, snapshotAt,
  type ComponentFingerprint, type HarnessSnapshot,
} from "./snapshots";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE harness_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, project TEXT,
    captured_at TEXT, fingerprint TEXT, payload TEXT
  )`);
  return db;
}

const comp = (
  type: ComponentFingerprint["type"], id: string, tokens: number | null, hash: string,
): ComponentFingerprint => ({ type, id, tokens, hash });

const snap = (capturedAt: string, components: ComponentFingerprint[], project: string | null = null): HarnessSnapshot =>
  ({ provider: "claude-code", project, capturedAt, fingerprint: capturedAt, components });

describe("diffSnapshots", () => {
  test("detects a shrunk instruction file with its token delta", () => {
    // The headline case: did trimming CLAUDE.md actually change anything?
    const before = snap("t1", [comp("instructions", "/CLAUDE.md", 3100, "h1")]);
    const after = snap("t2", [comp("instructions", "/CLAUDE.md", 1400, "h2")]);

    expect(diffSnapshots(before, after)).toEqual([{
      type: "instructions", id: "/CLAUDE.md", scope: undefined, change: "modified",
      tokensBefore: 3100, tokensAfter: 1400, tokensDelta: -1700,
    }]);
  });

  test("detects additions and removals", () => {
    const before = snap("t1", [comp("skill", "old-skill", 500, "h1")]);
    const after = snap("t2", [comp("skill", "new-skill", 800, "h2")]);

    const changes = diffSnapshots(before, after);

    expect(changes.find(c => c.id === "new-skill")).toMatchObject({ change: "added", tokensDelta: 800 });
    expect(changes.find(c => c.id === "old-skill")).toMatchObject({ change: "removed", tokensDelta: -500 });
  });

  test("an edit that keeps the token count is still a change", () => {
    // Two different edits can land on the same count; hashing the content is
    // what makes the diff trustworthy rather than the size alone.
    const before = snap("t1", [comp("instructions", "/CLAUDE.md", 900, "h1")]);
    const after = snap("t2", [comp("instructions", "/CLAUDE.md", 900, "h2")]);

    expect(diffSnapshots(before, after)).toMatchObject([{ change: "modified", tokensDelta: 0 }]);
  });

  test("an unchanged harness diffs to nothing", () => {
    const components = [
      comp("instructions", "/CLAUDE.md", 900, "h1"),
      comp("hook", "PreToolUse:*:0", null, "h2"),
    ];
    expect(diffSnapshots(snap("t1", components), snap("t2", components))).toEqual([]);
  });

  test("component order does not matter", () => {
    const a = [comp("skill", "x", 1, "h1"), comp("skill", "y", 2, "h2")];
    const b = [comp("skill", "y", 2, "h2"), comp("skill", "x", 1, "h1")];
    expect(diffSnapshots(snap("t1", a), snap("t2", b))).toEqual([]);
  });

  test("biggest token movement is reported first", () => {
    const before = snap("t1", [
      comp("instructions", "/small.md", 100, "a1"),
      comp("instructions", "/big.md", 5000, "b1"),
    ]);
    const after = snap("t2", [
      comp("instructions", "/small.md", 50, "a2"),
      comp("instructions", "/big.md", 1000, "b2"),
    ]);

    expect(diffSnapshots(before, after).map(c => c.id)).toEqual(["/big.md", "/small.md"]);
  });

  test("sizeless components report a null delta, not zero", () => {
    // Hooks, permissions and settings have no token size; claiming 0 would imply
    // they were measured and found free.
    const before = snap("t1", [comp("hook", "PreToolUse:*:0", null, "h1")]);
    const after = snap("t2", [comp("hook", "PreToolUse:*:0", null, "h2")]);

    expect(diffSnapshots(before, after)[0]!.tokensDelta).toBeNull();
  });
});

describe("recordSnapshot", () => {
  test("writes the first snapshot and skips an identical follow-up", () => {
    // The fingerprint gate is what keeps a 15-minute timer from filling the table.
    const db = seedDb();
    const s = { ...snap("t1", [comp("skill", "x", 1, "h1")]), fingerprint: "fp-1" };

    expect(recordSnapshot(db, s)).toBe(true);
    expect(recordSnapshot(db, { ...s, capturedAt: "t2" })).toBe(false);
    expect(db.query(`SELECT COUNT(*) as n FROM harness_snapshots`).get()).toEqual({ n: 1 });
  });

  test("writes again once the fingerprint moves", () => {
    const db = seedDb();
    recordSnapshot(db, { ...snap("t1", []), fingerprint: "fp-1" });
    expect(recordSnapshot(db, { ...snap("t2", []), fingerprint: "fp-2" })).toBe(true);
    expect(db.query(`SELECT COUNT(*) as n FROM harness_snapshots`).get()).toEqual({ n: 2 });
  });

  test("user scope and project scope are separate series", () => {
    const db = seedDb();
    recordSnapshot(db, { ...snap("t1", [], null), fingerprint: "fp" });
    // Same fingerprint, different scope — must not be deduped against user scope.
    expect(recordSnapshot(db, { ...snap("t1", [], "/proj"), fingerprint: "fp" })).toBe(true);
  });
});

describe("snapshotAt", () => {
  test("returns the newest snapshot at or before the moment", () => {
    const db = seedDb();
    recordSnapshot(db, { ...snap("2026-07-01T00:00:00.000Z", []), fingerprint: "a" });
    recordSnapshot(db, { ...snap("2026-07-10T00:00:00.000Z", []), fingerprint: "b" });

    const hit = snapshotAt(db, "claude-code", "2026-07-05T00:00:00.000Z");

    expect(hit?.snapshot.fingerprint).toBe("a");
    expect(hit?.exact).toBe(true);
  });

  test("marks a fallback as inexact when the moment predates every capture", () => {
    // A run from before the log existed has no true snapshot; the caller has to
    // be able to tell the user the config diff is approximate.
    const db = seedDb();
    recordSnapshot(db, { ...snap("2026-07-10T00:00:00.000Z", []), fingerprint: "b" });

    const hit = snapshotAt(db, "claude-code", "2026-01-01T00:00:00.000Z");

    expect(hit?.snapshot.fingerprint).toBe("b");
    expect(hit?.exact).toBe(false);
  });

  test("returns null when nothing was ever captured", () => {
    expect(snapshotAt(seedDb(), "claude-code", "2026-07-05T00:00:00.000Z")).toBeNull();
  });

  test("user scope does not match a project-scoped snapshot", () => {
    const db = seedDb();
    recordSnapshot(db, { ...snap("2026-07-01T00:00:00.000Z", [], "/proj"), fingerprint: "p" });
    expect(snapshotAt(db, "claude-code", "2026-07-05T00:00:00.000Z", null)).toBeNull();
  });

  test("a project matches regardless of drive-letter case on Windows", () => {
    // A run's cwd carries whatever case the session was launched with, so an
    // exact match would silently degrade to "no snapshot covers this run" —
    // the harness attribution would just vanish.
    const db = seedDb();
    recordSnapshot(db, { ...snap("2026-07-01T00:00:00.000Z", [], "G:\\AI\\proj"), fingerprint: "p" });

    const hit = snapshotAt(db, "claude-code", "2026-07-05T00:00:00.000Z", "g:\\AI\\proj");

    if (process.platform === "win32") {
      expect(hit?.snapshot.fingerprint).toBe("p");
    } else {
      expect(hit).toBeNull();
    }
  });
});

describe("harnessChangeLog", () => {
  test("dates each edit and lists what moved", () => {
    const db = seedDb();
    recordSnapshot(db, {
      ...snap("2026-07-01T00:00:00.000Z", [comp("instructions", "/CLAUDE.md", 3100, "h1")]),
      fingerprint: "fp1",
    });
    recordSnapshot(db, {
      ...snap("2026-07-05T00:00:00.000Z", [comp("instructions", "/CLAUDE.md", 1400, "h2")]),
      fingerprint: "fp2",
    });

    const log = harnessChangeLog(
      db, "claude-code", "2026-07-01T00:00:00.000Z", "2026-07-30T00:00:00.000Z",
    );

    expect(log).toHaveLength(1);
    expect(log[0]!.capturedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(log[0]!.changes[0]).toMatchObject({ id: "/CLAUDE.md", tokensDelta: -1700 });
  });

  test("an edit at the very start of the window still shows up", () => {
    // Seeded with the snapshot in effect just before the window, otherwise the
    // first capture inside it has nothing to diff against and the change is lost.
    const db = seedDb();
    recordSnapshot(db, {
      ...snap("2026-06-20T00:00:00.000Z", [comp("skill", "x", 100, "h1")]),
      fingerprint: "fp1",
    });
    recordSnapshot(db, {
      ...snap("2026-07-02T00:00:00.000Z", [comp("skill", "x", 900, "h2")]),
      fingerprint: "fp2",
    });

    const log = harnessChangeLog(
      db, "claude-code", "2026-07-01T00:00:00.000Z", "2026-07-30T00:00:00.000Z",
    );

    expect(log).toHaveLength(1);
    expect(log[0]!.changes[0]).toMatchObject({ change: "modified", tokensDelta: 800 });
  });

  test("an unreadable payload is skipped, not fatal", () => {
    // The cost comparison around the harness diff does not depend on snapshots,
    // so one corrupt row must not take the whole answer down with it.
    const db = seedDb();
    db.run(
      `INSERT INTO harness_snapshots (provider,project,captured_at,fingerprint,payload)
       VALUES ('claude-code',NULL,'2026-07-01T00:00:00.000Z','bad','{not json')`,
    );
    recordSnapshot(db, {
      ...snap("2026-07-05T00:00:00.000Z", [comp("skill", "x", 100, "h1")]),
      fingerprint: "fp2",
    });

    expect(() => harnessChangeLog(db, "claude-code", "2026-07-01T00:00:00.000Z", "2026-07-30T00:00:00.000Z"))
      .not.toThrow();
    expect(snapshotAt(db, "claude-code", "2026-07-10T00:00:00.000Z")?.snapshot.fingerprint).toBe("fp2");
  });

  test("a stable harness produces an empty timeline", () => {
    const db = seedDb();
    recordSnapshot(db, { ...snap("2026-07-01T00:00:00.000Z", []), fingerprint: "fp1" });
    expect(harnessChangeLog(db, "claude-code", "2026-07-01T00:00:00.000Z", "2026-07-30T00:00:00.000Z"))
      .toEqual([]);
  });

  test("each project keeps its own series", () => {
    const db = seedDb();
    for (const project of [null, "/proj"]) {
      recordSnapshot(db, {
        ...snap("2026-07-01T00:00:00.000Z", [comp("permissions", "effective", null, "p1")], project),
        fingerprint: `${project}-1`,
      });
      recordSnapshot(db, {
        ...snap("2026-07-05T00:00:00.000Z", [comp("permissions", "effective", null, "p2")], project),
        fingerprint: `${project}-2`,
      });
    }

    const log = harnessChangeLog(
      db, "claude-code", "2026-07-01T00:00:00.000Z", "2026-07-30T00:00:00.000Z",
    );

    // One change point per scope, not a cross-scope diff that invents changes.
    expect(log).toHaveLength(2);
    expect(new Set(log.map(e => e.project))).toEqual(new Set([null, "/proj"]));
  });
});
