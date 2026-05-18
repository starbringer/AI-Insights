import type { Database } from "bun:sqlite";
import { getClaudeMdAudit, type ClaudeMdAudit } from "./claudeMd";
import { getHooksAudit, type HooksAudit } from "./hooks";
import { getSkillsAudit, type SkillsAudit } from "./skills";
import { getMcpAudit, type McpAudit } from "./mcp";
import { getPluginsAudit, type PluginsAudit } from "./plugins";
import { getSettingsAudit, type SettingsAudit } from "./settings";
import { getModelStats, getCacheHitRate, getDailySeries, getSessionCount } from "../transcripts/aggregate";
import { getThresholds, statusForMin, type Status } from "../thresholds";

export interface ModelMixAudit {
  status: Status;
  daily30d: { date: string; byModel: Record<string, number> }[];
  totals: Record<string, number>;
}

export interface AuditReport {
  generatedAt: string;
  claudeMd: ClaudeMdAudit;
  hooks: HooksAudit;
  skills: SkillsAudit;
  mcp: McpAudit;
  plugins: PluginsAudit;
  settings: SettingsAudit;
  modelMix: ModelMixAudit;
  cacheHitRate30d: number;
  sessions30d: number;
  overallStatus: Status;
}

let _cache: { report: AuditReport; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function getAuditReport(db: Database, projectPaths: string[] = [], forceRefresh = false): Promise<AuditReport> {
  if (_cache && !forceRefresh && Date.now() - _cache.ts < CACHE_TTL) {
    return _cache.report;
  }

  const t = getThresholds();

  const [claudeMd, hooks, skills, mcp, plugins, settings] = await Promise.all([
    Promise.resolve(getClaudeMdAudit(db, projectPaths)),
    Promise.resolve(getHooksAudit(db)),
    Promise.resolve(getSkillsAudit()),
    Promise.resolve(getMcpAudit()),
    Promise.resolve(getPluginsAudit()),
    Promise.resolve(getSettingsAudit()),
  ]);

  const modelStats = getModelStats(db, new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const daily30d = getDailySeries(db, 30);
  const totals: Record<string, number> = {};
  for (const m of modelStats) totals[m.model] = m.total;

  const dailyByModel = daily30d.map(d => ({
    date: d.date,
    byModel: {} as Record<string, number>,
  }));

  const modelMix: ModelMixAudit = {
    status: "ok",
    daily30d: dailyByModel,
    totals,
  };

  const ago30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const cacheHitRate30d = getCacheHitRate(db, ago30);
  const sessions30d = getSessionCount(db, ago30);
  const cacheStatus = statusForMin(cacheHitRate30d, t.cacheHitRateMin);

  const statuses: Status[] = [claudeMd.status, hooks.status, mcp.status, settings.status, cacheStatus];
  const overallStatus: Status = statuses.includes("error") ? "error"
    : statuses.includes("warn") ? "warn" : "ok";

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    claudeMd, hooks, skills, mcp, plugins, settings, modelMix,
    cacheHitRate30d, sessions30d, overallStatus,
  };

  _cache = { report, ts: Date.now() };
  return report;
}

export function invalidateCache(): void {
  _cache = null;
}
