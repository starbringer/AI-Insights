import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db";
import {
  getTotals, getDailySeries, getAgents, getProjects,
  getModelStats, getCacheHitRate, getTopTurns, localMidnightIso,
  parseRange, rangeSinceIso, getRangeSeries, getMcpUsage, getSkillUsage,
} from "../transcripts/aggregate";
import { listRuns, loadRun, getTopRuns, getActiveRuns } from "../transcripts/runs";
import { getRunUsage } from "../transcripts/usageReport";
import { PROVIDERS } from "../providers";
import { resolveProvider } from "./providerParam";

export const transcriptRouter = new Hono();

/**
 * Resolve `?provider=` or answer 400. Every usage route is scoped to one data
 * source (default: the first registered provider, `all` to aggregate), so the
 * numbers stay meaningful once a second tool is plugged in.
 */
function providerOr400(c: Context): { filter: string | null } | Response {
  const res = resolveProvider(c.req.query("provider"));
  if (!res.ok) return c.json({ error: res.error }, 400);
  return { filter: res.filter };
}

transcriptRouter.get("/stats", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const today = localMidnightIso(0);
  const ago7  = localMidnightIso(7);
  const ago30 = localMidnightIso(30);

  return c.json({
    today:    getTotals(db, today, p.filter),
    sevenDays: getTotals(db, ago7, p.filter),
    thirtyDays: getTotals(db, ago30, p.filter),
    cacheHitRate30d: getCacheHitRate(db, ago30, p.filter),
    activeRuns: getActiveRuns(db, undefined, p.filter),
  });
});

transcriptRouter.get("/timeseries", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  if (range) return c.json(getRangeSeries(db, range, p.filter));
  const days = parseInt(c.req.query("days") ?? "30", 10);
  return c.json(getDailySeries(db, days, p.filter));
});

transcriptRouter.get("/agents", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const limit  = parseInt(c.req.query("limit")  ?? "50",  10);
  const offset = parseInt(c.req.query("offset") ?? "0",   10);
  const project = c.req.query("project");
  const search  = c.req.query("search");
  return c.json(getAgents(db, { limit, offset, project, search, provider: p.filter }));
});

transcriptRouter.get("/runs", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const limit  = parseInt(c.req.query("limit")  ?? "50",  10);
  const offset = parseInt(c.req.query("offset") ?? "0",   10);
  const project = c.req.query("project");
  const search  = c.req.query("search");
  return c.json(listRuns(db, { limit, offset, project, search, provider: p.filter }));
});

// Run and agent ids are globally unique across providers, so the detail routes
// resolve the owning provider from the row itself rather than from the query
// string; `?provider=` acts as an assertion and 404s on a mismatch.
transcriptRouter.get("/run/:runId", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const detail = loadRun(db, c.req.param("runId"));
  if (!detail) return c.json({ error: "not found" }, 404);
  if (p.filter && detail.run.provider !== p.filter) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});

transcriptRouter.get("/run/:runId/usage", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const runId = c.req.param("runId");
  if (p.filter) {
    const owner = db.query<{ provider: string }, [string]>(
      `SELECT provider FROM runs WHERE run_id = ?`
    ).get(runId);
    if (owner && owner.provider !== p.filter) return c.json({ error: "not found" }, 404);
  }
  const report = getRunUsage(db, runId);
  if (!report) return c.json({ error: "not found" }, 404);
  return c.json(report);
});

transcriptRouter.get("/projects", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  return c.json(getProjects(db, range ? rangeSinceIso(range) : undefined, p.filter));
});

transcriptRouter.get("/models", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  const since = range ? rangeSinceIso(range) : c.req.query("since");
  return c.json(getModelStats(db, since, p.filter));
});

transcriptRouter.get("/top-turns", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  return c.json(getTopTurns(db, limit, p.filter));
});

transcriptRouter.get("/top-runs", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const range = parseRange(c.req.query("range"));
  return c.json(getTopRuns(db, limit, range ? rangeSinceIso(range) : undefined, p.filter));
});

transcriptRouter.get("/mcp-usage", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const range = parseRange(c.req.query("range")) ?? "30d";
  return c.json(getMcpUsage(db, rangeSinceIso(range), p.filter));
});

transcriptRouter.get("/skill-usage", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const range = parseRange(c.req.query("range")) ?? "30d";
  return c.json(getSkillUsage(db, rangeSinceIso(range), p.filter));
});

transcriptRouter.get("/agent/:agentId/tree", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const agentId = c.req.param("agentId");

  const row = db.query<{ provider: string }, [string]>(
    `SELECT provider FROM agents WHERE agent_id = ?`
  ).get(agentId);
  if (row && p.filter && row.provider !== p.filter) return c.json({ error: "not found" }, 404);

  const candidates = row
    ? PROVIDERS.filter(x => x.id === row.provider)
    : PROVIDERS.filter(x => !p.filter || x.id === p.filter);
  for (const provider of candidates) {
    if (!provider.loadAgentTree) continue;
    const tree = provider.loadAgentTree(agentId);
    if (tree) return c.json(tree);
  }
  return c.json({ error: "not found" }, 404);
});

transcriptRouter.get("/agent/:agentId", c => {
  const p = providerOr400(c);
  if (p instanceof Response) return p;
  const db = getDb();
  const agentId = c.req.param("agentId");

  // Look up the agent's provider from the DB, then dispatch to that provider's
  // detail loader. Falls back to searching every candidate provider if not found.
  const row = db.query<{ provider: string }, [string]>(
    `SELECT provider FROM agents WHERE agent_id = ?`
  ).get(agentId);

  if (row) {
    if (p.filter && row.provider !== p.filter) return c.json([]);
    const provider = PROVIDERS.find(x => x.id === row.provider);
    if (provider) return c.json(provider.loadAgentDetail(agentId));
  }

  for (const provider of PROVIDERS) {
    if (p.filter && provider.id !== p.filter) continue;
    const turns = provider.loadAgentDetail(agentId);
    if (turns.length > 0) return c.json(turns);
  }
  return c.json([]);
});
