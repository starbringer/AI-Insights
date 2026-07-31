import { test, expect, describe } from "bun:test";
import { resolveWindow, clampWarning } from "./window";

// Retention facts are injected so these tests never depend on the on-disk
// setting — the same pattern clampRange(range, window) already uses.
const CUTOFF = "2026-07-01T00:00:00.000Z";
const LIMITS = { cutoffIso: CUTOFF, retentionDays: 30 };

const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe("bound parsing", () => {
  test("a bare date covers the whole local day", () => {
    // Storage is UTC ISO, so a bare date read as UTC midnight would cut the day
    // hours off for anyone outside UTC. Both bounds anchor to local time, and
    // `until` rolls to the next midnight so the named end day is included.
    const w = resolveWindow({ from: "2026-07-10", until: "2026-07-12" }, "w", LIMITS);
    expect(w.fromIso).toBe(localMidnight(2026, 7, 10));
    expect(w.untilIso).toBe(localMidnight(2026, 7, 13));
  });

  test("a relative offset means 'ago'", () => {
    const w = resolveWindow({ from: "7d", until: "1d" }, "w", LIMITS);
    const spanHours = (new Date(w.untilIso).getTime() - new Date(w.fromIso).getTime()) / 3600_000;
    expect(spanHours).toBeCloseTo(6 * 24, 1);
  });

  test("hours are accepted too", () => {
    const w = resolveWindow({ from: "24h", until: "1h" }, "w", LIMITS);
    const spanHours = (new Date(w.untilIso).getTime() - new Date(w.fromIso).getTime()) / 3600_000;
    expect(spanHours).toBeCloseTo(23, 1);
  });

  test("a full ISO timestamp passes through", () => {
    const w = resolveWindow(
      { from: "2026-07-10T08:30:00.000Z", until: "2026-07-10T17:00:00.000Z" }, "w", LIMITS,
    );
    expect(w.fromIso).toBe("2026-07-10T08:30:00.000Z");
    expect(w.untilIso).toBe("2026-07-10T17:00:00.000Z");
  });

  test("a missing until means now", () => {
    const w = resolveWindow({ from: "2026-07-10" }, "w", LIMITS);
    expect(new Date(w.untilIso).getTime()).toBeCloseTo(Date.now(), -4);
  });

  test("unparseable text is rejected with the accepted forms", () => {
    expect(() => resolveWindow({ from: "last tuesday" }, "w", LIMITS)).toThrow(/relative offset/);
  });

  test("a bare number is rejected instead of being read as a month", () => {
    // new Date("7") is July 2001, which would fail the retention check with an
    // error about a window the caller never asked for.
    expect(() => resolveWindow({ from: "7" }, "w", LIMITS)).toThrow(/ambiguous/);
    expect(() => resolveWindow({ from: "7" }, "w", LIMITS)).toThrow(/"7d" for days/);
  });

  test("from must be required and must precede until", () => {
    expect(() => resolveWindow({}, "w", LIMITS)).toThrow(/"from" is required/);
    expect(() => resolveWindow({ from: "2026-07-12", until: "2026-07-10" }, "w", LIMITS))
      .toThrow(/is not before/);
  });
});

describe("retention guard", () => {
  test("a window entirely before the cutoff is refused, not answered with zeros", () => {
    // Reporting 0 would read as "you spent nothing then", which is worse than an
    // error — the data was deleted, not absent.
    expect(() => resolveWindow({ from: "2026-05-01", until: "2026-06-01" }, "before window", LIMITS))
      .toThrow(/retention is set to 30 days/);
    expect(() => resolveWindow({ from: "2026-05-01", until: "2026-06-01" }, "before window", LIMITS))
      .toThrow(/before window/);
  });

  test("a window that only starts too early is clamped and flagged", () => {
    const w = resolveWindow({ from: "2026-06-20", until: "2026-07-10" }, "before window", LIMITS);
    expect(w.clamped).toBe(true);
    expect(w.fromIso).toBe(CUTOFF);
    expect(clampWarning(w)).toContain("before window was trimmed");
    expect(clampWarning(w)).toContain("30 days");
  });

  test("a window inside the cutoff is untouched and warns nothing", () => {
    const w = resolveWindow({ from: "2026-07-10", until: "2026-07-12" }, "w", LIMITS);
    expect(w.clamped).toBe(false);
    expect(clampWarning(w)).toBeNull();
  });

  test("a window ending exactly at the cutoff is refused (bounds are half-open)", () => {
    expect(() => resolveWindow({ from: "2026-06-01T00:00:00.000Z", until: CUTOFF }, "w", LIMITS))
      .toThrow(/retention/);
  });
});
