import { Hono } from "hono";
import { getDb } from "../db";
import {
  getTotals, getDailySeries, getAgents, getProjects,
  getModelStats, getCacheHitRate, getTopTurns, localMidnightIso,
  parseRange, rangeSinceIso, getRangeSeries, getMcpUsage, getSkillUsage,
} from "../transcripts/aggregate";
import { listRuns, loadRun, getTopRuns, getActiveRuns } from "../transcripts/runs";
import { PROVIDERS } from "../providers";

export const transcriptRouter = new Hono();

transcriptRouter.get("/stats", c => {
  const db = getDb();
  const today = localMidnightIso(0);
  const ago7  = localMidnightIso(7);
  const ago30 = localMidnightIso(30);

  return c.json({
    today:    getTotals(db, today),
    sevenDays: getTotals(db, ago7),
    thirtyDays: getTotals(db, ago30),
    cacheHitRate30d: getCacheHitRate(db, ago30),
    activeRuns: getActiveRuns(db),
  });
});

transcriptRouter.get("/timeseries", c => {
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  if (range) return c.json(getRangeSeries(db, range));
  const days = parseInt(c.req.query("days") ?? "30", 10);
  return c.json(getDailySeries(db, days));
});

transcriptRouter.get("/agents", c => {
  const db = getDb();
  const limit  = parseInt(c.req.query("limit")  ?? "50",  10);
  const offset = parseInt(c.req.query("offset") ?? "0",   10);
  const project = c.req.query("project");
  const search  = c.req.query("search");
  return c.json(getAgents(db, { limit, offset, project, search }));
});

transcriptRouter.get("/runs", c => {
  const db = getDb();
  const limit  = parseInt(c.req.query("limit")  ?? "50",  10);
  const offset = parseInt(c.req.query("offset") ?? "0",   10);
  const project = c.req.query("project");
  const search  = c.req.query("search");
  return c.json(listRuns(db, { limit, offset, project, search }));
});

transcriptRouter.get("/run/:runId", c => {
  const db = getDb();
  const runId = c.req.param("runId");
  const detail = loadRun(db, runId);
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});

transcriptRouter.get("/projects", c => {
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  return c.json(getProjects(db, range ? rangeSinceIso(range) : undefined));
});

transcriptRouter.get("/models", c => {
  const db = getDb();
  const range = parseRange(c.req.query("range"));
  const since = range ? rangeSinceIso(range) : c.req.query("since");
  return c.json(getModelStats(db, since));
});

transcriptRouter.get("/top-turns", c => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  return c.json(getTopTurns(db, limit));
});

transcriptRouter.get("/top-runs", c => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const range = parseRange(c.req.query("range"));
  return c.json(getTopRuns(db, limit, range ? rangeSinceIso(range) : undefined));
});

transcriptRouter.get("/mcp-usage", c => {
  const db = getDb();
  const range = parseRange(c.req.query("range")) ?? "30d";
  return c.json(getMcpUsage(db, rangeSinceIso(range)));
});

transcriptRouter.get("/skill-usage", c => {
  const db = getDb();
  const range = parseRange(c.req.query("range")) ?? "30d";
  return c.json(getSkillUsage(db, rangeSinceIso(range)));
});

transcriptRouter.get("/agent/:agentId/tree", c => {
  const db = getDb();
  const agentId = c.req.param("agentId");

  const row = db.query<{ provider: string }, [string]>(
    `SELECT provider FROM agents WHERE agent_id = ?`
  ).get(agentId);

  const candidates = row
    ? PROVIDERS.filter(p => p.id === row.provider)
    : PROVIDERS;
  for (const provider of candidates) {
    if (!provider.loadAgentTree) continue;
    const tree = provider.loadAgentTree(agentId);
    if (tree) return c.json(tree);
  }
  return c.json({ error: "not found" }, 404);
});

transcriptRouter.get("/agent/:agentId", c => {
  const db = getDb();
  const agentId = c.req.param("agentId");

  // Look up the agent's provider from the DB, then dispatch to that provider's
  // detail loader. Falls back to searching every provider if not found.
  const row = db.query<{ provider: string }, [string]>(
    `SELECT provider FROM agents WHERE agent_id = ?`
  ).get(agentId);

  if (row) {
    const provider = PROVIDERS.find(p => p.id === row.provider);
    if (provider) return c.json(provider.loadAgentDetail(agentId));
  }

  for (const provider of PROVIDERS) {
    const turns = provider.loadAgentDetail(agentId);
    if (turns.length > 0) return c.json(turns);
  }
  return c.json([]);
});
