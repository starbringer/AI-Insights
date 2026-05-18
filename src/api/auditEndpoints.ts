import { Hono } from "hono";
import { getDb } from "../db";
import { getAuditReport, invalidateCache } from "../audit/index";
import { getThresholds, saveThresholds } from "../thresholds";
import { getPricing, savePricing } from "../pricing";

export const auditRouter = new Hono();

auditRouter.get("/", async c => {
  const db = getDb();
  const report = await getAuditReport(db);
  return c.json(report);
});

auditRouter.post("/refresh", async c => {
  invalidateCache();
  const db = getDb();
  const report = await getAuditReport(db, [], true);
  return c.json(report);
});

auditRouter.get("/thresholds", c => {
  return c.json(getThresholds());
});

auditRouter.put("/thresholds", async c => {
  const body = await c.req.json();
  const updated = saveThresholds(body as Record<string, number>);
  invalidateCache();
  return c.json(updated);
});

auditRouter.get("/pricing", c => {
  return c.json(getPricing());
});

auditRouter.put("/pricing", async c => {
  const body = await c.req.json();
  savePricing(body);
  return c.json({ ok: true });
});
