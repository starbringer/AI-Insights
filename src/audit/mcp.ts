import { countTokensInObject } from "../tokenizer";
import { getThresholds, statusForValue, type Status } from "../thresholds";
import { CLAUDE_BIN } from "../paths";

export interface McpServer {
  name: string;
  scope: "user" | "claude.ai" | "local" | "project" | "unknown";
  type: "stdio" | "http" | "sse";
  command?: string;
  toolCount: number;
  schemaTokens: number;
}

export interface McpAudit {
  status: Status;
  servers: McpServer[];
  totalTools: number;
  totalSchemaTokens: number;
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

function queryMcpSchema(command: string, args: string[]): { toolCount: number; schemaTokens: number } {
  if (!command) return { toolCount: 0, schemaTokens: 0 };

  // Full MCP handshake over stdio: initialize → initialized notification → tools/list.
  const stdin = ndjson(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "llm-usage", version: "0.1.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  );

  try {
    const proc = Bun.spawnSync({
      cmd: [command, ...args],
      stdin,
      stdout: "pipe",
      stderr: "ignore",
      env: process.env as Record<string, string>,
      timeout: 8000,
    });

    // Find the tools/list reply (id 2). Parse regardless of exit code — a server
    // may answer correctly and then exit non-zero once stdin reaches EOF.
    for (const msg of parseNdjson(proc.stdout.toString("utf-8"))) {
      const m = msg as { id?: number; result?: { tools?: unknown[] } };
      if (m.id === 2 && m.result?.tools) {
        return { toolCount: m.result.tools.length, schemaTokens: countTokensInObject(m.result.tools) };
      }
    }
  } catch { /* spawn failed, timeout, or crash */ }

  return { toolCount: 0, schemaTokens: 0 };
}

function getMcpScope(name: string): McpServer["scope"] {
  // Claude.ai-hosted MCPs are identified by name prefix
  if (name.startsWith("claude.ai ") || name.startsWith("claude.ai/")) return "claude.ai";
  try {
    // `claude mcp get` health-checks the server before printing, which can
    // take several seconds — a short timeout reports every scope as unknown.
    const proc = Bun.spawnSync({ cmd: [CLAUDE_BIN, "mcp", "get", name], stdout: "pipe", stderr: "ignore", timeout: 15000 });
    const out = proc.stdout.toString("utf-8");
    if (out.includes("Local config")) return "local";
    if (out.includes("Project config")) return "project";
    if (out.includes("User config")) return "user";
    if (out.includes("claude.ai config")) return "claude.ai";
  } catch { /* ignore */ }
  return "unknown";
}

export function getMcpAudit(): McpAudit {
  const t = getThresholds();
  const servers: McpServer[] = [];

  try {
    // `claude mcp list` health-checks every server before printing, so give it
    // enough headroom — a slow probe must not blank out the whole server list.
    const proc = Bun.spawnSync({ cmd: [CLAUDE_BIN, "mcp", "list"], stdout: "pipe", stderr: "pipe", timeout: 20000 });
    const output = proc.stdout.toString("utf-8") + proc.stderr.toString("utf-8");

    // Output format: "<name>: <connection-info> - ✔ Connected" or "✘ Error…".
    // Accept every check/cross variant the CLI has used (✓ U+2713, ✔ U+2714,
    // ✗ U+2717, ✘ U+2718) — matching the wrong codepoint silently empties the
    // whole list.
    for (const line of output.split("\n")) {
      const m = line.match(/^(.+?):\s+(.+?)\s+-\s+[✓✔✗✘×xX]/u);
      if (!m) continue;
      const name = m[1].trim();
      const connInfo = m[2].trim();

      const isHttp = connInfo.startsWith("http://") || connInfo.startsWith("https://");
      const type: McpServer["type"] = isHttp ? "http" : "stdio";
      const scope = getMcpScope(name);

      let toolCount = 0, schemaTokens = 0;
      if (!isHttp) {
        // connInfo is "<command> [args...]" — split on first whitespace boundary
        const spaceIdx = connInfo.indexOf(" ");
        const command = spaceIdx >= 0 ? connInfo.slice(0, spaceIdx) : connInfo;
        const args = spaceIdx >= 0 ? connInfo.slice(spaceIdx + 1).split(/\s+/).filter(Boolean) : [];
        const result = queryMcpSchema(command, args);
        toolCount = result.toolCount;
        schemaTokens = result.schemaTokens;
      }

      servers.push({ name, scope, type, command: connInfo, toolCount, schemaTokens });
    }
  } catch { /* claude CLI not available */ }

  const totalTools = servers.reduce((s, srv) => s + srv.toolCount, 0);
  const totalSchemaTokens = servers.reduce((s, srv) => s + srv.schemaTokens, 0);

  const serverStatus = statusForValue(servers.length, t.mcpServers);
  const schemaStatus = statusForValue(totalSchemaTokens, t.mcpSchemaTokens);
  const status: Status = serverStatus === "error" || schemaStatus === "error" ? "error"
    : serverStatus === "warn" || schemaStatus === "warn" ? "warn" : "ok";

  return { status, servers, totalTools, totalSchemaTokens };
}
