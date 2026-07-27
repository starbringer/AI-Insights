import { Hono } from "hono";
import { getThresholds, saveThresholds } from "../thresholds";
import { getPricing } from "../pricing";

// App-level settings the Settings tab reads and edits. Thresholds feed the
// warn/error status shown on the Harness tabs; pricing is read-only over HTTP
// (edit data/pricing.json to change it) since it drives every cost number.
export const settingsRouter = new Hono();

settingsRouter.get("/thresholds", c => {
  return c.json(getThresholds());
});

settingsRouter.put("/thresholds", async c => {
  const body = await c.req.json();
  return c.json(saveThresholds(body as Record<string, number>));
});

settingsRouter.get("/pricing", c => {
  return c.json(getPricing());
});
