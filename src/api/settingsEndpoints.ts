import { Hono } from "hono";
import { getThresholds, saveThresholds } from "../thresholds";
import { getPricing } from "../pricing";
import { getDb } from "../db";
import { PROVIDERS } from "../providers";
import {
  DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS,
  clampRetentionDays, getRetentionDays, pruneOldData, resetIngestState, setRetentionDays,
} from "../retention";

// App-level settings the Settings tab reads and edits. Thresholds feed the
// warn/error status shown on the Harness tabs; retention decides how much
// history the cache keeps; pricing is read-only over HTTP (edit
// data/pricing.json to change it) since it drives every cost number.
export const settingsRouter = new Hono();

settingsRouter.get("/thresholds", c => {
  return c.json(getThresholds());
});

settingsRouter.put("/thresholds", async c => {
  const body = await c.req.json();
  return c.json(saveThresholds(body as Record<string, number>));
});

settingsRouter.get("/retention", c => {
  return c.json({
    retentionDays: getRetentionDays(),
    defaultDays: DEFAULT_RETENTION_DAYS,
    minDays: MIN_RETENTION_DAYS,
    maxDays: MAX_RETENTION_DAYS,
  });
});

/**
 * Change the retention window.
 *
 * Narrowing deletes the now-out-of-window records immediately — the setting
 * would be a lie if the data lingered. Widening re-scans every transcript from
 * byte 0, because the rows for the newly-covered days were deleted by an
 * earlier sweep and only a full re-parse can bring back what is still on disk.
 */
settingsRouter.put("/retention", async c => {
  const body = await c.req.json().catch(() => ({}));
  const requested = clampRetentionDays((body as { retentionDays?: unknown }).retentionDays);
  const previous = getRetentionDays();
  const retentionDays = setRetentionDays(requested);

  const db = getDb();
  let rescanned = false;
  if (retentionDays > previous) {
    resetIngestState(db);
    for (const provider of PROVIDERS) {
      if (!provider.hasData()) continue;
      try {
        provider.scanAll(db);
        rescanned = true;
      } catch (e) {
        console.error(`[retention] re-scan failed for provider "${provider.id}":`, e);
      }
    }
  }
  const pruned = pruneOldData(db);

  return c.json({ retentionDays, previousDays: previous, rescanned, pruned });
});

settingsRouter.get("/pricing", c => {
  return c.json(getPricing());
});
