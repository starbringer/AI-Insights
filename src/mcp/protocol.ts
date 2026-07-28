import { MCP_TOOLS, MCP_TOOLS_BY_NAME } from "./tools";

// ============================================================================
// MCP JSON-RPC dispatch — transport-independent.
//
// Both front doors (the /mcp HTTP endpoint and the stdio bridge) hand raw
// JSON-RPC messages to `handleMessage` and forward whatever comes back. Keeping
// the protocol here means the two transports can never disagree about what the
// server supports.
//
// The server is intentionally STATELESS: no Mcp-Session-Id is issued, so every
// request stands alone. Nothing this server does spans requests — it answers
// read-only queries against a local SQLite cache — and statelessness removes a
// whole class of session-expiry bugs for clients that reconnect freely.
// ============================================================================

export const SERVER_NAME = "ai-insights";
export const SERVER_VERSION = "0.1.0";

/** Newest revision we speak. Echoed back when the client asks for it. */
export const LATEST_PROTOCOL_VERSION = "2025-06-18";

/**
 * Revisions we can serve. Older clients negotiate down; the wire shape this
 * server uses (tools/list + tools/call with text content) is identical across
 * all three.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const SERVER_INSTRUCTIONS = [
  "Local, read-only analytics over your AI coding tool usage: token counts, costs,",
  "session history and harness configuration (instruction files, skills, commands,",
  "hooks, MCP servers, permissions, memory, settings).",
  "",
  "Every tool takes an optional `provider` argument naming the data source;",
  'it defaults to Claude Code, and "all" aggregates across every source.',
  "Call list_providers first if you are unsure which ids are valid.",
  "",
  "Token counts are deduplicated per API response, so they are directly",
  "comparable across tools. Costs are API-equivalent estimates from a local",
  "pricing table, not billing figures.",
  "",
  "This server never writes. To act on a finding, edit the file yourself.",
].join("\n");

// ---- JSON-RPC shapes --------------------------------------------------------

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Does this inbound message call for a response body?
 *
 * No, for the two kinds the spec says to acknowledge with a bare 202:
 * notifications (a request with no `id`) and responses to server-initiated
 * requests (no `method` at all). Everything else is a request and gets answered.
 */
export function expectsResponse(msg: unknown): boolean {
  if (!isRecord(msg)) return true;              // malformed → answer with an error
  if (typeof msg["method"] !== "string") return false; // a response, not a request
  return msg["id"] !== undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---- dispatch ---------------------------------------------------------------

/**
 * Handle one JSON-RPC message. Returns the response to send, or `null` for
 * notifications (which get an acknowledgement at the transport layer instead).
 */
export async function handleMessage(msg: unknown): Promise<JsonRpcResponse | null> {
  if (!isRecord(msg) || typeof msg["method"] !== "string") {
    return fail(null, ERROR_CODES.invalidRequest, "not a JSON-RPC request");
  }

  const method = msg["method"];
  const id = (msg["id"] ?? null) as JsonRpcId;
  const notification = msg["id"] === undefined;
  const params = isRecord(msg["params"]) ? msg["params"] : {};

  // Notifications never get a response body, whatever they are.
  if (notification) return null;

  switch (method) {
    case "initialize":
      return ok(id, initializeResult(params));

    case "ping":
      // Liveness probe; an empty result is the whole contract.
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: MCP_TOOLS.map(t => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });

    case "tools/call":
      return ok(id, await callTool(params));

    // Declared-but-empty capabilities. Answering these rather than erroring
    // keeps clients that probe every capability quiet in the logs.
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });

    default:
      return fail(id, ERROR_CODES.methodNotFound, `unknown method: ${method}`);
  }
}

function initializeResult(params: Record<string, unknown>) {
  const requested = typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : "";
  // Echo the client's revision when we speak it; otherwise offer our newest and
  // let the client decide whether it can proceed.
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      // listChanged: false — the tool set is fixed at build time.
      tools: { listChanged: false },
    },
    serverInfo: { name: SERVER_NAME, title: "AI Insights", version: SERVER_VERSION },
    instructions: SERVER_INSTRUCTIONS,
  };
}

/**
 * Run one tool. Per the MCP spec, a tool that fails reports the failure inside
 * a successful result with `isError: true` — protocol errors are reserved for
 * the request being malformed, so the model can see and react to tool failures.
 */
async function callTool(params: Record<string, unknown>) {
  const name = params["name"];
  if (typeof name !== "string") {
    return errorResult('tools/call requires a string "name"');
  }
  const tool = MCP_TOOLS_BY_NAME.get(name);
  if (!tool) {
    return errorResult(`unknown tool "${name}". Call tools/list for the available tools.`);
  }

  const args = isRecord(params["arguments"]) ? params["arguments"] : {};
  try {
    const value = await tool.handler(args);
    return { content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }] };
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

function errorResult(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}
