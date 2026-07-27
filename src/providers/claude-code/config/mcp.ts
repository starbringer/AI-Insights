import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countTokensInObject } from "../../../tokenizer";
import { getThresholds, statusForValue, type Status } from "../../../thresholds";
import { CLAUDE_JSON_PATH } from "../../../paths";
import type { McpToolInfo, McpServerInfo, McpReport } from "../../../config/types";

// ============================================================================
// MCP report — enumerates servers from Claude Code's CONFIG FILES, never from
// `claude mcp list`. The CLI health-checks every server before printing (slow,
// network-dependent, can exceed any spawn timeout with empty stdout) and its
// human-readable output format drifts across versions — both failure modes
// produced a silently empty server list in the past. Config files are the
// source of truth the CLI itself reads, so this enumeration is deterministic:
//   user scope    → ~/.claude.json  top-level `mcpServers`
//   local scope   → ~/.claude.json  `projects[<dir>].mcpServers`
//   project scope → <dir>/.mcp.json `mcpServers`
//   claude.ai     → account-hosted connectors (names cached in
//                   `claudeAiMcpEverConnected`; definitions live server-side)
// Tool lists/schemas come from live probes (stdio JSON-RPC or streamable
// HTTP), and every enumeration or probe failure is reported in `diagnostics`
// instead of being swallowed.
// ============================================================================

interface McpServerDef {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ProbeResult {
  tools: McpToolInfo[];
  error?: string;
}

// MCP's stdio transport frames each JSON-RPC message as a single line of JSON
// terminated by a newline — NOT LSP-style "Content-Length" headers. Sending the
// wrong framing makes servers reject every message, so the probe found 0 tools.
function ndjson(...messages: unknown[]): Buffer {
  return Buffer.from(messages.map(m => JSON.stringify(m)).join("\n") + "\n", "utf-8");
}

function parseNdjson(raw: string): unknown[] {
  const results: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { results.push(JSON.parse(trimmed)); } catch { /* skip non-JSON log lines */ }
  }
  return results;
}

const INITIALIZE_MSG = {
  jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "ai-insights", version: "0.1.0" } },
};
const INITIALIZED_MSG = { jsonrpc: "2.0", method: "notifications/initialized" };
const TOOLS_LIST_MSG  = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function toToolInfos(tools: unknown[]): McpToolInfo[] {
  return tools.map(t => {
    const tool = t as { name?: string; description?: string; inputSchema?: unknown };
    return {
      name: String(tool.name ?? "unknown"),
      description: String(tool.description ?? "").slice(0, 500),
      tokens: countTokensInObject(t),
      inputSchema: tool.inputSchema ?? null,
    };
  });
}

function probeStdio(def: McpServerDef): ProbeResult {
  if (!def.command) return { tools: [], error: "no command in config" };

  // Full MCP handshake over stdio: initialize → initialized notification → tools/list.
  const stdin = ndjson(INITIALIZE_MSG, INITIALIZED_MSG, TOOLS_LIST_MSG);

  try {
    const proc = Bun.spawnSync({
      cmd: [def.command, ...(def.args ?? [])],
      stdin,
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, ...(def.env ?? {}) } as Record<string, string>,
      timeout: 8000,
    });

    // Find the tools/list reply (id 2). Parse regardless of exit code — a server
    // may answer correctly and then exit non-zero once stdin reaches EOF.
    for (const msg of parseNdjson(proc.stdout.toString("utf-8"))) {
      const m = msg as { id?: number; result?: { tools?: unknown[] } };
      if (m.id === 2 && m.result?.tools) return { tools: toToolInfos(m.result.tools) };
    }
    return { tools: [], error: `no tools/list reply (exit ${proc.exitCode ?? "timeout"})` };
  } catch (e) {
    return { tools: [], error: `spawn failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Streamable-HTTP responses may be plain JSON or a text/event-stream body;
// extract every JSON-RPC message from either.
function parseHttpBody(contentType: string, body: string): unknown[] {
  if (contentType.includes("text/event-stream")) {
    const messages: unknown[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try { messages.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
    }
    return messages;
  }
  try { return [JSON.parse(body)]; } catch { return []; }
}

async function probeHttp(def: McpServerDef): Promise<ProbeResult> {
  if (!def.url) return { tools: [], error: "no url in config" };

  const post = async (msg: unknown, sessionId?: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(def.headers ?? {}),
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    return fetch(def.url as string, {
      method: "POST", headers, body: JSON.stringify(msg),
      signal: AbortSignal.timeout(10_000),
    });
  };

  try {
    const initRes = await post(INITIALIZE_MSG);
    if (initRes.status === 401 || initRes.status === 403) {
      return { tools: [], error: `authentication required (HTTP ${initRes.status})` };
    }
    if (!initRes.ok) return { tools: [], error: `initialize failed (HTTP ${initRes.status})` };
    const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;
    await initRes.text(); // drain

    // The initialized notification is best-effort; some servers don't need it.
    try { await (await post(INITIALIZED_MSG, sessionId)).text(); } catch { /* optional */ }

    const listRes = await post(TOOLS_LIST_MSG, sessionId);
    if (!listRes.ok) return { tools: [], error: `tools/list failed (HTTP ${listRes.status})` };
    const messages = parseHttpBody(listRes.headers.get("content-type") ?? "", await listRes.text());
    for (const msg of messages) {
      const m = msg as { id?: number; result?: { tools?: unknown[] } };
      if (m.id === 2 && m.result?.tools) return { tools: toToolInfos(m.result.tools) };
    }
    return { tools: [], error: "no tools/list reply in response" };
  } catch (e) {
    return { tools: [], error: `request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Probes spawn processes / hit the network, so cache results per server
// DEFINITION — a config change gets a fresh probe, an unchanged one reuses the
// last result until the TTL lapses. A forced refresh re-probes everything.
const PROBE_TTL = 10 * 60_000;
const probeCache = new Map<string, { ts: number; result: ProbeResult }>();

async function probeServer(name: string, def: McpServerDef, type: McpServerInfo["type"], forceRefresh: boolean): Promise<ProbeResult> {
  const key = `${name}:${JSON.stringify(def)}`;
  const cached = probeCache.get(key);
  if (cached && !forceRefresh && Date.now() - cached.ts < PROBE_TTL) return cached.result;

  const result = type === "stdio" ? probeStdio(def) : await probeHttp(def);
  probeCache.set(key, { ts: Date.now(), result });
  return result;
}

function defType(def: McpServerDef): McpServerInfo["type"] {
  if (def.type === "http" || (!def.type && def.url)) return "http";
  if (def.type === "sse") return "sse";
  return "stdio";
}

function defDisplayCommand(def: McpServerDef): string {
  if (def.url) return def.url;
  return [def.command ?? "", ...(def.args ?? [])].join(" ").trim();
}

interface EnumeratedServer {
  name: string;
  def: McpServerDef | null; // null → definition not available locally (claude.ai)
  scope: McpServerInfo["scope"];
  source: string;
  project?: string;
  noProbeReason?: string;   // set → listed but never probed (consent / no local def)
}

function enumerateServers(diagnostics: string[]): EnumeratedServer[] {
  const found: EnumeratedServer[] = [];

  let claudeJson: {
    mcpServers?: Record<string, McpServerDef>;
    projects?: Record<string, {
      mcpServers?: Record<string, McpServerDef>;
      enabledMcpjsonServers?: string[];
      disabledMcpjsonServers?: string[];
      enableAllProjectMcpServers?: boolean;
    }>;
    claudeAiMcpEverConnected?: string[];
  } | null = null;

  if (!existsSync(CLAUDE_JSON_PATH)) {
    diagnostics.push(`${CLAUDE_JSON_PATH} not found — no user/local scope MCP servers readable`);
  } else {
    try {
      claudeJson = JSON.parse(readFileSync(CLAUDE_JSON_PATH, "utf-8"));
    } catch (e) {
      diagnostics.push(`failed to read ${CLAUDE_JSON_PATH}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // User scope: available in every project.
  for (const [name, def] of Object.entries(claudeJson?.mcpServers ?? {})) {
    found.push({ name, def, scope: "user", source: CLAUDE_JSON_PATH });
  }

  // Local scope + project scope: keyed by the project dirs Claude Code has
  // seen. Windows records the same dir with varying case, so case-fold there to
  // dedupe; on case-sensitive filesystems (macOS/Linux) key verbatim, or
  // distinct dirs collapse and their local/project servers get dropped.
  const seenDirs = new Set<string>();
  for (const [dir, proj] of Object.entries(claudeJson?.projects ?? {})) {
    const dirKey = process.platform === "win32" ? dir.toLowerCase() : dir;
    if (seenDirs.has(dirKey)) continue;
    seenDirs.add(dirKey);

    for (const [name, def] of Object.entries(proj?.mcpServers ?? {})) {
      found.push({ name, def, scope: "local", source: CLAUDE_JSON_PATH, project: dir });
    }

    const mcpJsonPath = join(dir, ".mcp.json");
    if (!existsSync(mcpJsonPath)) continue;
    try {
      const projectJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8")) as { mcpServers?: Record<string, McpServerDef> };
      for (const [name, def] of Object.entries(projectJson.mcpServers ?? {})) {
        // .mcp.json ships with the repo, i.e. is third-party content. Claude
        // Code only runs these servers after explicit user approval — mirror
        // that: list unapproved ones, but never execute or contact them.
        const approved = proj?.enableAllProjectMcpServers === true
          || (proj?.enabledMcpjsonServers ?? []).includes(name);
        const disabled = (proj?.disabledMcpjsonServers ?? []).includes(name);
        const noProbeReason = disabled ? "disabled for this project in Claude Code — not probed"
          : !approved ? "not approved for this project in Claude Code — not probed"
          : undefined;
        found.push({ name, def, scope: "project", source: mcpJsonPath, project: dir, noProbeReason });
      }
    } catch (e) {
      diagnostics.push(`failed to read ${mcpJsonPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // claude.ai-hosted connectors: only their names are cached locally; the
  // definitions (and OAuth) live in the claude.ai account.
  for (const name of claudeJson?.claudeAiMcpEverConnected ?? []) {
    found.push({ name, def: null, scope: "claude.ai", source: `${CLAUDE_JSON_PATH} (claudeAiMcpEverConnected)` });
  }

  return found;
}

export async function getMcpReport(forceRefresh = false): Promise<McpReport> {
  const t = getThresholds();
  const diagnostics: string[] = [];
  const enumerated = enumerateServers(diagnostics);

  const servers: McpServerInfo[] = await Promise.all(enumerated.map(async e => {
    if (!e.def) {
      return {
        name: e.name, scope: e.scope, type: "http" as const, source: e.source,
        toolCount: 0, schemaTokens: 0, tools: [],
        probeError: "hosted on claude.ai — definition and tools are account-side, not stored locally",
      };
    }
    const type = defType(e.def);
    if (e.noProbeReason) {
      return {
        name: e.name, scope: e.scope, type, command: defDisplayCommand(e.def),
        source: e.source, project: e.project,
        toolCount: 0, schemaTokens: 0, tools: [],
        probeError: e.noProbeReason,
      };
    }
    const probe = await probeServer(e.name, e.def, type, forceRefresh);
    return {
      name: e.name, scope: e.scope, type, command: defDisplayCommand(e.def),
      source: e.source, project: e.project,
      toolCount: probe.tools.length,
      schemaTokens: probe.tools.length ? countTokensInObject(probe.tools.map(x => ({ name: x.name, description: x.description, inputSchema: x.inputSchema }))) : 0,
      tools: probe.tools,
      probeError: probe.error,
    };
  }));

  for (const s of servers) {
    // Intentionally-skipped probes (claude.ai-hosted, unapproved project
    // servers) are explained on their row; diagnostics is for real failures.
    if (s.probeError && s.scope !== "claude.ai" && !s.probeError.endsWith("not probed")) {
      diagnostics.push(`probe of "${s.name}" (${s.type}): ${s.probeError}`);
    }
  }
  if (diagnostics.length) console.warn("[mcp]", diagnostics.join(" | "));

  const totalTools = servers.reduce((s, srv) => s + srv.toolCount, 0);
  const totalSchemaTokens = servers.reduce((s, srv) => s + srv.schemaTokens, 0);

  const serverStatus = statusForValue(servers.length, t.mcpServers);
  const schemaStatus = statusForValue(totalSchemaTokens, t.mcpSchemaTokens);
  const status: Status = serverStatus === "error" || schemaStatus === "error" ? "error"
    : serverStatus === "warn" || schemaStatus === "warn" ? "warn" : "ok";

  return { status, servers, totalTools, totalSchemaTokens, diagnostics };
}
