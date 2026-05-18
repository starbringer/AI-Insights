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

function framed(json: string): Buffer {
  const body = Buffer.from(json, "utf-8");
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header), body]);
}

function parseFramed(raw: string): unknown[] {
  const results: unknown[] = [];
  let i = 0;
  while (i < raw.length) {
    const clMatch = raw.slice(i).match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
    if (!clMatch) break;
    const headerLen = clMatch[0].length;
    const bodyLen = parseInt(clMatch[1], 10);
    const bodyStart = i + headerLen;
    try {
      results.push(JSON.parse(raw.slice(bodyStart, bodyStart + bodyLen)));
    } catch { /* skip */ }
    i = bodyStart + bodyLen;
  }
  return results;
}

function queryMcpSchema(command: string, args: string[]): { toolCount: number; schemaTokens: number } {
  if (!command) return { toolCount: 0, schemaTokens: 0 };

  const initMsg = framed(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "llm-usage", version: "0.1.0" } },
  }));
  const toolsMsg = framed(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));

  try {
    const proc = Bun.spawnSync({
      cmd: [command, ...args],
      stdin: Buffer.concat([initMsg, toolsMsg]),
      stdout: "pipe",
      stderr: "ignore",
      env: process.env as Record<string, string>,
      timeout: 4000,
    });

    if (proc.exitCode !== 0 && proc.exitCode !== null) return { toolCount: 0, schemaTokens: 0 };

    const raw = proc.stdout.toString("utf-8");
    const msgs = parseFramed(raw);

    for (const msg of msgs) {
      const m = msg as { id?: number; result?: { tools?: unknown[] } };
      if (m.id === 2 && m.result?.tools) {
        return { toolCount: m.result.tools.length, schemaTokens: countTokensInObject(m.result.tools) };
      }
    }
  } catch { /* timeout or crash */ }

  return { toolCount: 0, schemaTokens: 0 };
}

function getMcpScope(name: string): McpServer["scope"] {
  // Claude.ai-hosted MCPs are identified by name prefix
  if (name.startsWith("claude.ai ") || name.startsWith("claude.ai/")) return "claude.ai";
  try {
    const proc = Bun.spawnSync({ cmd: [CLAUDE_BIN, "mcp", "get", name], stdout: "pipe", stderr: "ignore", timeout: 3000 });
    const out = proc.stdout.toString("utf-8");
    if (out.includes("Local config")) return "local";
    if (out.includes("Project config")) return "project";
    if (out.includes("User config")) return "user";
  } catch { /* ignore */ }
  return "unknown";
}

export function getMcpAudit(): McpAudit {
  const t = getThresholds();
  const servers: McpServer[] = [];

  try {
    const proc = Bun.spawnSync({ cmd: [CLAUDE_BIN, "mcp", "list"], stdout: "pipe", stderr: "pipe", timeout: 12000 });
    const output = proc.stdout.toString("utf-8") + proc.stderr.toString("utf-8");

    // Output format: "<name>: <connection-info> - ✓ Connected" or "✗ Error..."
    for (const line of output.split("\n")) {
      const m = line.match(/^(.+?):\s+(.+?)\s+-\s+[✓✗]/);
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
