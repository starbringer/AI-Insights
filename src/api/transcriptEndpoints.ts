import { Hono } from "hono";
import { getDb } from "../db";
import {
  getTotals, getDailySeries, getSessions, getProjects,
  getModelStats, getCacheHitRate, getTopTurns, getTopSessions, getActiveSessions,
} from "../transcripts/aggregate";
import { loadSessionDetail } from "../transcripts/sessionDetail";

export const transcriptRouter = new Hono();

transcriptRouter.get("/stats", c => {
  const db = getDb();
  const today    = new Date().toISOString().slice(0, 10);
  const ago7     = new Date(Date.now() -  7 * 86400_000).toISOString().slice(0, 10);
  const ago30    = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  return c.json({
    today:    getTotals(db, today),
    sevenDays: getTotals(db, ago7),
    thirtyDays: getTotals(db, ago30),
    cacheHitRate30d: getCacheHitRate(db, ago30),
    activeSessions: getActiveSessions(db),
  });
});

transcriptRouter.get("/timeseries", c => {
  const db = getDb();
  const days = parseInt(c.req.query("days") ?? "30", 10);
  return c.json(getDailySeries(db, days));
});

transcriptRouter.get("/sessions", c => {
  const db = getDb();
  const limit  = parseInt(c.req.query("limit")  ?? "50",  10);
  const offset = parseInt(c.req.query("offset") ?? "0",   10);
  const project = c.req.query("project");
  const search  = c.req.query("search");
  return c.json(getSessions(db, { limit, offset, project, search }));
});

transcriptRouter.get("/projects", c => {
  const db = getDb();
  return c.json(getProjects(db));
});

transcriptRouter.get("/models", c => {
  const db = getDb();
  const since = c.req.query("since");
  return c.json(getModelStats(db, since));
});

transcriptRouter.get("/top-turns", c => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  return c.json(getTopTurns(db, limit));
});

transcriptRouter.get("/top-sessions", c => {
  const db = getDb();
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  return c.json(getTopSessions(db, limit));
});

transcriptRouter.get("/session/:sessionId", c => {
  const sessionId = c.req.param("sessionId");
  const turns = loadSessionDetail(sessionId);
  return c.json(turns);
});
