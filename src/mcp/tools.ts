import { getDb } from "../db";
import { listProviders } from "../providers";
import { configAdapterFor } from "../config";
import { buildDependencyGraph } from "../config/graph";
import { getPricing } from "../pricing";
import { getThresholds } from "../thresholds";
import { resolveProvider } from "../api/providerParam";
import {
  getTotals, getDailySeries, getAgents, getProjects, getModelStats,
  getCacheHitRate, getTopTurns, localMidnightIso, parseRange, rangeSinceIso,
  getRangeSeries, getMcpUsage, getSkillUsage,
} from "../transcripts/aggregate";
import { listRuns, loadRun, getTopRuns, getActiveRuns } from "../transcripts/runs";
import { getRunUsage } from "../transcripts/usageReport";
import type { UsageAdvice } from "../transcripts/usageReport";

// ============================================================================
// MCP tool registry.
//
// Every HTTP read route has a tool here, calling the same library function the
// route calls — the MCP surface is a second front door onto one implementation,
// not a re-implementation.
//
// Two rules hold for the whole registry:
//   1. READ-ONLY. The write routes (PUT/POST/DELETE on instructions, commands,
//      skills, hooks, thresholds) are deliberately NOT exposed: an assistant
//      that can silently rewrite CLAUDE.md, a hook script or a skill from an
//      analysis run is a footgun. Recommendations come back as text; the user's
//      own agent applies them through its normal, permission-gated edit tools.
//   2. Every tool takes `provider`. Omitted = the default source (Claude Code),
//      "all" = aggregate across every registered source.
//
// Payload discipline: tools that could return whole files (skills, commands,
// instruction files, MCP JSON schemas) default to metadata only and require an
// explicit flag to include bodies. A usage-analysis tool that floods its own
// caller's context would be self-defeating.
// ============================================================================

export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  handler(args: Record<string, unknown>): unknown | Promise<unknown>;
}

// ---- shared schema fragments ------------------------------------------------

const providerProp = {
  provider: {
    type: "string",
    description: 'Data source id (default "claude-code"). Use "all" to aggregate every source. Call list_providers for the valid ids.',
  },
} as const;

const rangeProp = {
  range: {
    type: "string",
    enum: ["1h", "24h", "7d", "30d"],
    description: "Time window. Default 30d.",
  },
} as const;

const limitProp = (fallback: number) => ({
  limit: { type: "integer", minimum: 1, maximum: 500, description: `Max rows. Default ${fallback}.` },
});

// ---- argument helpers -------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`"${key}" must be a string`);
  return v;
}

function requiredStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key);
  if (!v) throw new Error(`"${key}" is required`);
  return v;
}

function int(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`"${key}" must be a number`);
  return Math.trunc(n);
}

function bool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`"${key}" must be a boolean`);
}

/** Provider filter for the usage queries, or a thrown error naming valid ids. */
function providerFilter(args: Record<string, unknown>): string | null {
  const res = resolveProvider(str(args, "provider"));
  if (!res.ok) throw new Error(res.error);
  return res.filter;
}

/** The config adapter for this call, or a thrown error. Config is per-tool. */
function adapter(args: Record<string, unknown>) {
  const requested = str(args, "provider");
  const a = configAdapterFor(requested);
  if (!a) {
    throw new Error(
      requested
        ? `no configuration adapter for provider "${requested}"`
        : "no configuration adapter is registered",
    );
  }
  return a;
}

/** Throw a clear "this provider can't do that" instead of a null-deref. */
function capabilityOr(a: ReturnType<typeof adapter>, method: keyof typeof a, label: string): void {
  if (!a[method]) throw new Error(`${label} is not supported by provider "${a.providerId}"`);
}

function rangeOf(args: Record<string, unknown>, fallback: "1h" | "24h" | "7d" | "30d" = "30d") {
  return parseRange(str(args, "range")) ?? fallback;
}

// ---- advice rendering -------------------------------------------------------
// The HTTP API returns advice as { id, params } so the UI can localize it. An
// assistant reading this needs prose, so the MCP layer renders it.

const ADVICE_TEXT: Record<UsageAdvice["id"], (p: Record<string, number | string>) => string> = {
  "switch-cheaper-model": p =>
    `Premium-tier models dominate this run. Re-priced at ${p["model"]}, the same calls would cost about $${p["usd"]} (${p["pct"]}%) less.`,
  "low-cache-hit": p =>
    `Only ${p["pct"]}% of the input side was served from prompt cache. Keep instruction files and system prompts stable across turns and avoid long idle gaps.`,
  "subagents-heavy": p =>
    `${p["pct"]}% of tokens burned inside spawned sub-agents. Check whether some of that work could run inline or on a cheaper model.`,
};

function renderAdvice(advice: UsageAdvice[]) {
  return advice.map(a => ({ ...a, message: ADVICE_TEXT[a.id]?.(a.params) ?? a.id }));
}

// ---- projections ------------------------------------------------------------
// Drop the fields that only exist to render a UI, and strip file bodies unless
// the caller explicitly asked for them.

function trimText(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

const MAX_FILE_CHARS = 20_000;

// ============================================================================
// The registry
// ============================================================================

export const MCP_TOOLS: McpToolDef[] = [
  // ---- discovery -----------------------------------------------------------
  {
    name: "list_providers",
    title: "List data sources",
    description:
      "List the AI coding tools this app can read, with whether each currently has data on disk. Start here to learn the ids accepted by every other tool's `provider` argument.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => ({
      providers: listProviders(),
      defaultProvider: listProviders()[0]?.id ?? null,
      note: 'Pass any id as `provider`, or "all" to aggregate across every source.',
    }),
  },

  // ---- usage ---------------------------------------------------------------
  {
    name: "get_usage_summary",
    title: "Usage summary",
    description:
      "Headline token and cost totals for today, the last 7 days and the last 30 days, plus the 30-day cache hit rate and the count of currently active runs. The starting point for any usage review.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const p = providerFilter(args);
      const db = getDb();
      return {
        today: getTotals(db, localMidnightIso(0), p),
        sevenDays: getTotals(db, localMidnightIso(7), p),
        thirtyDays: getTotals(db, localMidnightIso(30), p),
        cacheHitRate30dPct: getCacheHitRate(db, localMidnightIso(30), p),
        activeRuns: getActiveRuns(db, undefined, p),
        note: "Costs are API-equivalent estimates from the local pricing table, not billing.",
      };
    },
  },
  {
    name: "get_usage_timeseries",
    title: "Token trend",
    description:
      "Token totals over time, split into input / cache-write / cache-read / output. Buckets adapt to the range: 5-minute for 1h, hourly for 24h, daily otherwise. Use it to spot spikes and cache-miss patterns.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      buckets: getRangeSeries(getDb(), rangeOf(args), providerFilter(args)),
    }),
  },
  {
    name: "get_model_usage",
    title: "Usage by model",
    description:
      "Token totals per model over the range. Use it to check whether expensive models are doing routine work.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      models: getModelStats(getDb(), rangeSinceIso(rangeOf(args)), providerFilter(args)),
    }),
  },
  {
    name: "get_project_usage",
    title: "Usage by project",
    description:
      "Token totals, run counts and agent counts per project directory over the range, newest activity first.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      projects: getProjects(getDb(), rangeSinceIso(rangeOf(args)), providerFilter(args)),
    }),
  },
  {
    name: "list_runs",
    title: "List sessions",
    description:
      "Paginated list of recorded sessions (a run = one logical session, containing one or more agents). Each row carries title, project, agent/turn counts, token totals and last-active time.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        ...limitProp(25),
        offset: { type: "integer", minimum: 0, description: "Rows to skip. Default 0." },
        project: { type: "string", description: "Filter to one project directory (exact cwd)." },
        search: { type: "string", description: "Substring match on run title or project path." },
      },
      additionalProperties: false,
    },
    handler: args => listRuns(getDb(), {
      limit: Math.min(int(args, "limit", 25), 500),
      offset: int(args, "offset", 0),
      project: str(args, "project"),
      search: str(args, "search"),
      provider: providerFilter(args),
    }),
  },
  {
    name: "get_run",
    title: "Session detail",
    description:
      "One run with every agent it contains (including spawned sub-agents), each with its model, turn count and token totals.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, runId: { type: "string", description: "Run id from list_runs." } },
      required: ["runId"],
      additionalProperties: false,
    },
    handler: args => {
      const p = providerFilter(args);
      const detail = loadRun(getDb(), requiredStr(args, "runId"));
      if (!detail) throw new Error("run not found");
      if (p && detail.run.provider !== p) throw new Error("run not found for this provider");
      return detail;
    },
  },
  {
    name: "get_run_usage",
    title: "Session cost breakdown",
    description:
      "Cost breakdown for one run: totals, per-model rollup, and per-call attribution into base / MCP / skills / sub-agents buckets, plus concrete tuning advice computed from this run's real numbers. The most useful single tool for explaining why a session was expensive.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        runId: { type: "string", description: "Run id from list_runs." },
        includeSeries: {
          type: "boolean",
          description: "Include the per-API-call cost series (can be hundreds of rows). Default false.",
        },
      },
      required: ["runId"],
      additionalProperties: false,
    },
    handler: args => {
      const p = providerFilter(args);
      const runId = requiredStr(args, "runId");
      const db = getDb();
      if (p) {
        const owner = db.query<{ provider: string }, [string]>(
          `SELECT provider FROM runs WHERE run_id = ?`
        ).get(runId);
        if (owner && owner.provider !== p) throw new Error("run not found for this provider");
      }
      const report = getRunUsage(db, runId);
      if (!report) throw new Error("run not found");
      const { series, advice, ...rest } = report;
      return {
        ...rest,
        advice: renderAdvice(advice),
        ...(bool(args, "includeSeries") ? { series } : { seriesOmitted: series.length }),
      };
    },
  },
  {
    name: "get_top_runs",
    title: "Most expensive sessions",
    description: "Runs ranked by total tokens over the range. Use it to find which sessions are worth reviewing.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp, ...limitProp(10) },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      runs: getTopRuns(getDb(), Math.min(int(args, "limit", 10), 500),
        rangeSinceIso(rangeOf(args)), providerFilter(args)),
    }),
  },
  {
    name: "get_top_turns",
    title: "Most expensive API calls",
    description:
      "The single largest API calls by total tokens, with model, timestamp and owning agent. Outliers here usually mean a huge tool result or an over-full context.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...limitProp(10) },
      additionalProperties: false,
    },
    handler: args => ({
      turns: getTopTurns(getDb(), Math.min(int(args, "limit", 10), 500), providerFilter(args)),
    }),
  },
  {
    name: "get_mcp_usage",
    title: "MCP token usage",
    description:
      "Estimated tokens injected by each configured MCP server's tool calls over the range, with a per-tool breakdown. Use it to find servers that cost context without earning it.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      servers: getMcpUsage(getDb(), rangeSinceIso(rangeOf(args)), providerFilter(args)),
      note: "Tokens are a chars/4 estimate of each call's input plus result payload.",
    }),
  },
  {
    name: "get_skill_usage",
    title: "Skill token usage",
    description:
      "Recorded skill invocations and their estimated injected tokens over the range. Zero-call skills are absent here — cross-reference list_skills to find skills that never fire.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, ...rangeProp },
      additionalProperties: false,
    },
    handler: args => ({
      range: rangeOf(args),
      skills: getSkillUsage(getDb(), rangeSinceIso(rangeOf(args)), providerFilter(args)),
    }),
  },
  {
    name: "list_agents",
    title: "List agents",
    description:
      "Agents (one transcript each) with their run, project, model, turn count and token totals. Sub-agents are flagged with is_subagent and carry their agent_type.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        ...limitProp(25),
        offset: { type: "integer", minimum: 0, description: "Rows to skip. Default 0." },
        project: { type: "string", description: "Filter to one project directory (exact cwd)." },
        search: { type: "string", description: "Substring match on agent title or project path." },
      },
      additionalProperties: false,
    },
    handler: args => getAgents(getDb(), {
      limit: Math.min(int(args, "limit", 25), 500),
      offset: int(args, "offset", 0),
      project: str(args, "project"),
      search: str(args, "search"),
      provider: providerFilter(args),
    }),
  },
  {
    name: "get_daily_usage",
    title: "Daily usage history",
    description:
      "Day-by-day token totals over the last N days (default 30). Longer history than get_usage_timeseries, which caps at 30 days.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        days: { type: "integer", minimum: 1, maximum: 365, description: "Days of history. Default 30." },
      },
      additionalProperties: false,
    },
    handler: args => ({
      days: Math.min(int(args, "days", 30), 365),
      buckets: getDailySeries(getDb(), Math.min(int(args, "days", 30), 365), providerFilter(args)),
    }),
  },

  // ---- harness configuration ----------------------------------------------
  {
    name: "get_harness_capabilities",
    title: "Harness capabilities",
    description:
      "Which configuration sections the provider's adapter supports (instructions, commands, skills, hooks, permissions, MCP, memory, effective config). Check this before calling the other config tools.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const a = adapter(args);
      return { providerId: a.providerId, ...a.capabilities() };
    },
  },
  {
    name: "list_instruction_files",
    title: "Instruction files",
    description:
      "Every always-injected instruction file (CLAUDE.md and friends) with its token and word count, plus an estimate of how many tokens they injected per day over the last 30 days. The single biggest lever on per-turn cost.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listInstructions", "instructions");
      return a.listInstructions?.(getDb());
    },
  },
  {
    name: "read_instruction_file",
    title: "Read an instruction file",
    description:
      "Full text of one instruction file listed by list_instruction_files. Read it before recommending edits — advice about a CLAUDE.md you have not read is guesswork.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, path: { type: "string", description: "Path exactly as returned by list_instruction_files." } },
      required: ["path"],
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "readInstructionFile", "reading instruction files");
      const file = a.readInstructionFile?.(getDb(), requiredStr(args, "path"));
      if (!file) throw new Error("instruction file not found");
      return { ...file, content: trimText(file.content, MAX_FILE_CHARS) };
    },
  },
  {
    name: "list_commands",
    title: "Slash commands",
    description:
      "Slash commands from every source (user / project / plugin) with token cost, argument hints and same-name override marking. Bodies are omitted unless includeContent is set.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        includeContent: { type: "boolean", description: "Include each command's full body. Default false." },
      },
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listCommands", "commands");
      const withBody = bool(args, "includeContent");
      return (a.listCommands?.(getDb()) ?? []).map(cmd =>
        withBody ? { ...cmd, content: trimText(cmd.content, MAX_FILE_CHARS) } : omit(cmd, "content"));
    },
  },
  {
    name: "list_skills",
    title: "Skills",
    description:
      "Every installed skill with its description, token cost, trigger keywords, bundled references/scripts, and its RECORDED invocations and injected tokens over 30 days. Comparing cost against calls is how you find skills that are not paying for themselves. Bodies are omitted unless includeContent is set.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        includeContent: { type: "boolean", description: "Include each SKILL.md body. Default false." },
      },
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listSkills", "skills");
      const withBody = bool(args, "includeContent");
      return (a.listSkills?.(getDb()) ?? []).map(skill =>
        withBody ? { ...skill, content: trimText(skill.content, MAX_FILE_CHARS) } : omit(skill, "content"));
    },
  },
  {
    name: "list_hooks",
    title: "Hooks",
    description:
      "Every configured hook across all settings layers, with its event, matcher, action type, resolved script path and RECORDED fire count over 30 days. A hook that never fires is either mis-matched or dead config.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listHooks", "hooks");
      return a.listHooks?.(getDb());
    },
  },
  {
    name: "read_hook_script",
    title: "Read a hook script",
    description: "Source of a hook's script file, using the scriptPath reported by list_hooks.",
    inputSchema: {
      type: "object",
      properties: { ...providerProp, path: { type: "string", description: "scriptPath exactly as returned by list_hooks." } },
      required: ["path"],
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "readHookScript", "reading hook scripts");
      const file = a.readHookScript?.(getDb(), requiredStr(args, "path"));
      if (!file) throw new Error("hook script not found");
      return { ...file, content: trimText(file.content, MAX_FILE_CHARS) };
    },
  },
  {
    name: "get_permissions",
    title: "Permission rules",
    description:
      "Merged allow / deny / ask rules across settings layers, with rules shadowed by a higher-priority layer marked. Thin allowlists are a common cause of repeated approval prompts.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        project: { type: "string", description: "Project directory whose layers to merge in. Omit for user scope only." },
      },
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "permissionModel", "permissions");
      return a.permissionModel?.(getDb(), str(args, "project"));
    },
  },
  {
    name: "list_mcp_servers",
    title: "Configured MCP servers",
    description:
      "MCP servers found in the tool's config files, with scope, transport, tool count, schema token cost and probe diagnostics. Cross-reference get_mcp_usage: a server with a large schema cost and no calls is pure overhead. JSON schemas are omitted unless includeSchemas is set.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        includeSchemas: { type: "boolean", description: "Include each tool's full JSON input schema. Large. Default false." },
        refresh: { type: "boolean", description: "Bypass the 10-minute probe cache and re-probe servers. Default false." },
      },
      additionalProperties: false,
    },
    handler: async args => {
      const a = adapter(args);
      capabilityOr(a, "mcpReport", "MCP inspection");
      const report = await a.mcpReport?.(getDb(), bool(args, "refresh"));
      if (!report) throw new Error("MCP inspection returned nothing");
      if (bool(args, "includeSchemas")) return report;
      return {
        ...report,
        servers: report.servers.map(s => ({
          ...s,
          tools: s.tools.map(t => omit(t, "inputSchema")),
        })),
      };
    },
  },
  {
    name: "list_memory_stores",
    title: "Memory stores",
    description:
      "Per-project persistent memory: the index file, every topic file with its content, size and last-modified time, and whether each topic is actually linked from the index (unlinked ones are orphans).",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listMemoryStores", "memory");
      return a.listMemoryStores?.(getDb());
    },
  },
  {
    name: "get_effective_config",
    title: "Effective settings",
    description:
      "Merged settings layers: every key's winning value, which layers it overrides, and warnings for keys set in a layer the tool never reads. Use it to check the default model, effort level and other cost-relevant settings.",
    inputSchema: {
      type: "object",
      properties: {
        ...providerProp,
        project: { type: "string", description: "Project directory whose layer to merge in. Omit for user scope only." },
      },
      additionalProperties: false,
    },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "effectiveConfig", "effective configuration");
      return a.effectiveConfig?.(getDb(), str(args, "project"));
    },
  },
  {
    name: "get_dependency_graph",
    title: "Configuration dependency graph",
    description:
      "How skills, hooks, MCP servers and commands reference each other, with detected dependency chains. Use it to see which pieces of config are wired together and which are isolated.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: async args => {
      const a = adapter(args);
      const db = getDb();
      const skills = a.listSkills?.(db) ?? [];
      const commands = a.listCommands?.(db) ?? [];
      const hooks = a.listHooks?.(db).entries ?? [];
      const mcpServers = a.mcpReport ? (await a.mcpReport(db)).servers : [];
      return buildDependencyGraph({
        skills: skills.filter(s => !s.overriddenBy),
        commands: commands.filter(x => !x.overriddenBy),
        hooks,
        mcpServers: mcpServers.map(s => ({ name: s.name })),
      });
    },
  },
  {
    name: "list_config_projects",
    title: "Known projects",
    description: "Project directories discovered from transcripts — the valid values for the `project` argument elsewhere.",
    inputSchema: { type: "object", properties: { ...providerProp }, additionalProperties: false },
    handler: args => {
      const a = adapter(args);
      capabilityOr(a, "listProjects", "project discovery");
      return { projects: a.listProjects?.(getDb()) ?? [] };
    },
  },

  // ---- app settings --------------------------------------------------------
  {
    name: "get_pricing",
    title: "Reference pricing",
    description:
      "The per-model price table behind every cost figure this app reports. Use it to reason about model-swap savings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => getPricing(),
  },
  {
    name: "get_thresholds",
    title: "Warning thresholds",
    description: "The configured warn/error thresholds behind the ok/warn/error badges on the dashboard's Harness tabs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => getThresholds(),
  },
];

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
}

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map(t => [t.name, t]));
