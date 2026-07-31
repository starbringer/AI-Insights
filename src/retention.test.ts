import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import {
  clampDays, clampRange, clampRetentionDays, pruneOldData, retentionCutoffIso,
  MAX_RETENTION_DAYS, MIN_RETENTION_DAYS,
} from "./retention";
import { parseRange, rangeDays, rangeSinceIso, localMidnightIso } from "./transcripts/aggregate";

// The retention window is the app's only destructive rule: it decides what is
// deleted, how far back every query looks, and which chart ranges exist. These
// tests pin the three down together.

describe("clampRetentionDays", () => {
  test("keeps whole days inside the supported bounds", () => {
    expect(clampRetentionDays(14)).toBe(14);
    expect(clampRetentionDays(0)).toBe(MIN_RETENTION_DAYS);
    expect(clampRetentionDays(-5)).toBe(MIN_RETENTION_DAYS);
    expect(clampRetentionDays(10_000)).toBe(MAX_RETENTION_DAYS);
    expect(clampRetentionDays(7.9)).toBe(7);
  });

  test("garbage falls back to the default rather than NaN", () => {
    expect(clampRetentionDays("nope")).toBe(30);
    expect(clampRetentionDays(undefined)).toBe(30);
    expect(clampRetentionDays(null)).toBe(30);
  });

  test("numeric strings from the settings form are accepted", () => {
    expect(clampRetentionDays("14")).toBe(14);
  });
});

describe("range parsing", () => {
  test("hour ranges and any day count round-trip", () => {
    expect(parseRange("1h")).toBe("1h");
    expect(parseRange("24h")).toBe("24h");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("14d")).toBe("14d");
    expect(parseRange("365d")).toBe("365d");
  });

  test("nonsense and zero-length windows are rejected", () => {
    for (const raw of ["", "d", "0d", "week", "7", "-3d", undefined]) {
      expect(parseRange(raw)).toBeNull();
    }
  });

  test("rangeDays separates day ranges from hour ranges", () => {
    expect(rangeDays("14d")).toBe(14);
    expect(rangeDays("1h")).toBeNull();
    expect(rangeDays("24h")).toBeNull();
  });

  test("a day range starts at local midnight, N-1 days back", () => {
    expect(rangeSinceIso("1d")).toBe(localMidnightIso(0));
    expect(rangeSinceIso("14d")).toBe(localMidnightIso(13));
  });
});

describe("retentionCutoffIso", () => {
  test("a multi-day window is anchored to local midnight, N-1 days back", () => {
    expect(retentionCutoffIso(30)).toBe(localMidnightIso(29));
    expect(retentionCutoffIso(7)).toBe(localMidnightIso(6));
  });

  test("the cutoff never rises above 24 hours ago, so the 24h range stays whole", () => {
    // At a 1-day window a bare midnight anchor would drop yesterday evening the
    // moment the clock rolls over, emptying most of the 24h chart every morning.
    const cutoff = retentionCutoffIso(1);
    expect(cutoff <= new Date(Date.now() - 24 * 3600_000).toISOString()).toBe(true);
    expect(cutoff <= localMidnightIso(0)).toBe(true);
  });
});

describe("clamping to the window", () => {
  test("a day range wider than the window is answered as the window", () => {
    expect(clampRange("90d", 30)).toBe("30d");
    expect(clampRange("30d", 14)).toBe("14d");
  });

  test("a range that fits is left alone", () => {
    expect(clampRange("7d", 30)).toBe("7d");
    expect(clampRange("14d", 14)).toBe("14d");
  });

  test("hour ranges always fit, even at the narrowest window", () => {
    expect(clampRange("1h", 1)).toBe("1h");
    expect(clampRange("24h", 1)).toBe("24h");
  });

  test("day counts clamp to [1, window], with the window as the fallback", () => {
    expect(clampDays(365, 30)).toBe(30);
    expect(clampDays(7, 30)).toBe(7);
    expect(clampDays(0, 30)).toBe(1);
    expect(clampDays(NaN, 30)).toBe(30);
  });
});

/** A DB with the columns prune touches — enough to exercise the delete rules. */
function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE turns (id INTEGER PRIMARY KEY, agent_id TEXT, run_id TEXT, ts TEXT)`);
  db.run(`CREATE TABLE events (id INTEGER PRIMARY KEY, agent_id TEXT, ts TEXT)`);
  db.run(`CREATE TABLE agents (agent_id TEXT PRIMARY KEY, run_id TEXT, started_at TEXT, last_seen_at TEXT)`);
  db.run(`CREATE TABLE runs (run_id TEXT PRIMARY KEY, last_seen_at TEXT)`);
  db.run(`CREATE TABLE harness_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, project TEXT, captured_at TEXT
  )`);
  return db;
}

const OLD = "2000-01-01T00:00:00.000Z";
const NOW = new Date().toISOString();

describe("pruneOldData", () => {
  test("drops aged-out turns, events, agents and runs", () => {
    const db = seedDb();
    db.run(`INSERT INTO turns VALUES (1,'old','runOld',?)`, [OLD]);
    db.run(`INSERT INTO events VALUES (1,'old',?)`, [OLD]);
    db.run(`INSERT INTO agents VALUES ('old','runOld',?,?)`, [OLD, OLD]);
    db.run(`INSERT INTO runs VALUES ('runOld',?)`, [OLD]);

    const res = pruneOldData(db);

    expect(res.turns).toBe(1);
    expect(res.events).toBe(1);
    expect(res.agents).toBe(1);
    expect(res.runs).toBe(1);
    expect(db.query(`SELECT * FROM turns`).all()).toEqual([]);
    expect(db.query(`SELECT * FROM runs`).all()).toEqual([]);
  });

  test("keeps recent rows untouched", () => {
    const db = seedDb();
    db.run(`INSERT INTO turns VALUES (1,'live','runLive',?)`, [NOW]);
    db.run(`INSERT INTO events VALUES (1,'live',?)`, [NOW]);
    db.run(`INSERT INTO agents VALUES ('live','runLive',?,?)`, [NOW, NOW]);
    db.run(`INSERT INTO runs VALUES ('runLive',?)`, [NOW]);

    const res = pruneOldData(db);

    expect(res).toMatchObject({ turns: 0, events: 0, agents: 0, runs: 0 });
    expect(db.query(`SELECT COUNT(*) as n FROM agents`).get()).toEqual({ n: 1 });
  });

  test("a long-running session is trimmed, not dropped", () => {
    // Started before the cutoff but still active: the old turns go, the agent
    // and its run stay because turns inside the window remain.
    const db = seedDb();
    db.run(`INSERT INTO turns VALUES (1,'a','r',?)`, [OLD]);
    db.run(`INSERT INTO turns VALUES (2,'a','r',?)`, [NOW]);
    db.run(`INSERT INTO agents VALUES ('a','r',?,?)`, [OLD, NOW]);
    db.run(`INSERT INTO runs VALUES ('r',?)`, [NOW]);

    const res = pruneOldData(db);

    expect(res.turns).toBe(1);
    expect(res.agents).toBe(0);
    expect(db.query(`SELECT COUNT(*) as n FROM turns`).get()).toEqual({ n: 1 });
    expect(db.query(`SELECT COUNT(*) as n FROM runs`).get()).toEqual({ n: 1 });
  });

  test("a brand-new agent with no turns yet survives", () => {
    const db = seedDb();
    db.run(`INSERT INTO agents VALUES ('fresh','rFresh',?,?)`, [NOW, NOW]);
    db.run(`INSERT INTO runs VALUES ('rFresh',?)`, [NOW]);

    pruneOldData(db);

    expect(db.query(`SELECT COUNT(*) as n FROM agents`).get()).toEqual({ n: 1 });
  });

  test("timestamp-less agents are anomalies, not aged-out rows", () => {
    const db = seedDb();
    db.run(`INSERT INTO agents VALUES ('nots','rNots',NULL,NULL)`);
    db.run(`INSERT INTO runs VALUES ('rNots',NULL)`);

    pruneOldData(db);

    expect(db.query(`SELECT COUNT(*) as n FROM agents`).get()).toEqual({ n: 1 });
    expect(db.query(`SELECT COUNT(*) as n FROM runs`).get()).toEqual({ n: 1 });
  });

  test("the newest pre-cutoff harness snapshot survives as a baseline", () => {
    // Aged-out snapshots go, EXCEPT the latest one before the cutoff: it is what
    // the oldest retained period is diffed against, so losing it would leave
    // that period's cost change unattributable.
    const db = seedDb();
    const older = "2000-01-01T00:00:00.000Z";
    const newer = "2000-06-01T00:00:00.000Z";
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('cc',NULL,?)`, [older]);
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('cc',NULL,?)`, [newer]);
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('cc',NULL,?)`, [NOW]);

    const res = pruneOldData(db);

    expect(res.snapshots).toBe(1);
    expect(db.query<{ captured_at: string }, []>(
      `SELECT captured_at FROM harness_snapshots ORDER BY captured_at`
    ).all().map(r => r.captured_at)).toEqual([newer, NOW]);
  });

  test("each provider/project series keeps its own baseline", () => {
    const db = seedDb();
    const old = "2000-01-01T00:00:00.000Z";
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('cc',NULL,?)`, [old]);
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('cc','/proj',?)`, [old]);
    db.run(`INSERT INTO harness_snapshots (provider,project,captured_at) VALUES ('other',NULL,?)`, [old]);

    const res = pruneOldData(db);

    // All three are the sole (and therefore baseline) row of their own series.
    expect(res.snapshots).toBe(0);
    expect(db.query(`SELECT COUNT(*) as n FROM harness_snapshots`).get()).toEqual({ n: 3 });
  });
});
