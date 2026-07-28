import { test, expect } from "bun:test";
import {
  ERROR_CODES, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS,
  expectsResponse, handleMessage,
} from "./protocol";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME } from "./tools";

// The MCP layer is the app's contract with every AI client that connects to it,
// so these tests pin the wire shape: handshake, discovery, error routing, and
// the invariants the tool registry has to keep (read-only, provider-aware).

test("initialize echoes a protocol version the client asked for", async () => {
  const res = await handleMessage({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
  });
  const result = res?.result as { protocolVersion: string; serverInfo: { name: string } };
  expect(result.protocolVersion).toBe("2025-03-26");
  expect(result.serverInfo.name).toBe("ai-insights");
});

test("initialize falls back to the newest version for an unknown request", async () => {
  const res = await handleMessage({
    jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" },
  });
  expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
});

test("the newest supported version is the advertised default", () => {
  expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe(LATEST_PROTOCOL_VERSION);
});

test("notifications get no response", async () => {
  expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
});

test("expectsResponse: requests yes, notifications and responses no", () => {
  expect(expectsResponse({ jsonrpc: "2.0", id: 1, method: "ping" })).toBe(true);
  expect(expectsResponse({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(false);
  expect(expectsResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(false);
});

test("ping answers with an empty result", async () => {
  const res = await handleMessage({ jsonrpc: "2.0", id: 7, method: "ping" });
  expect(res).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
});

test("unknown methods are a JSON-RPC error, not a crash", async () => {
  const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "nope/nope" });
  expect(res?.error?.code).toBe(ERROR_CODES.methodNotFound);
});

test("a malformed message is rejected as an invalid request", async () => {
  const res = await handleMessage({ hello: "world" });
  expect(res?.error?.code).toBe(ERROR_CODES.invalidRequest);
});

test("tools/list returns every registered tool with a schema", async () => {
  const res = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  const tools = (res?.result as { tools: { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }[] }).tools;
  expect(tools.length).toBe(MCP_TOOLS.length);
  for (const t of tools) {
    expect(t.inputSchema).toBeDefined();
    // Every tool is read-only; the write routes are deliberately not exposed.
    expect(t.annotations.readOnlyHint).toBe(true);
  }
});

test("empty capabilities answer instead of erroring", async () => {
  const resources = await handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  expect((resources?.result as { resources: unknown[] }).resources).toEqual([]);
  const prompts = await handleMessage({ jsonrpc: "2.0", id: 5, method: "prompts/list" });
  expect((prompts?.result as { prompts: unknown[] }).prompts).toEqual([]);
});

// ---- tools/call error routing ----
// Tool failures are reported INSIDE a successful result so the model can see
// and react to them; protocol errors are reserved for malformed requests.

test("calling an unknown tool yields isError, not a protocol error", async () => {
  const res = await handleMessage({
    jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "not_a_tool", arguments: {} },
  });
  expect(res?.error).toBeUndefined();
  expect((res?.result as { isError: boolean }).isError).toBe(true);
});

test("an unknown provider is reported as a tool error naming the valid ids", async () => {
  const res = await handleMessage({
    jsonrpc: "2.0", id: 8, method: "tools/call",
    params: { name: "get_usage_summary", arguments: { provider: "definitely-not-a-provider" } },
  });
  const result = res?.result as { isError: boolean; content: { text: string }[] };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("claude-code");
});

test("list_providers works and returns JSON text content", async () => {
  const res = await handleMessage({
    jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_providers", arguments: {} },
  });
  const result = res?.result as { isError?: boolean; content: { type: string; text: string }[] };
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.type).toBe("text");
  const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { providers: { id: string }[] };
  expect(parsed.providers.some(p => p.id === "claude-code")).toBe(true);
});

// ---- registry invariants ----

test("tool names are unique and snake_case", () => {
  expect(MCP_TOOLS_BY_NAME.size).toBe(MCP_TOOLS.length);
  for (const t of MCP_TOOLS) expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
});

test("every tool has a non-trivial description and a closed schema", () => {
  for (const t of MCP_TOOLS) {
    expect(t.description.length).toBeGreaterThan(30);
    expect(t.inputSchema.type).toBe("object");
    // additionalProperties:false makes a typo in an argument name a visible
    // error rather than a silently ignored one.
    expect(t.inputSchema.additionalProperties).toBe(false);
  }
});

test("every data tool accepts a provider argument", () => {
  // Only the three tools whose answer cannot vary per source are exempt.
  const exempt = new Set(["list_providers", "get_pricing", "get_thresholds"]);
  for (const t of MCP_TOOLS) {
    if (exempt.has(t.name)) continue;
    expect(Object.keys(t.inputSchema.properties)).toContain("provider");
  }
});

test("required arguments are declared in the schema", () => {
  for (const t of MCP_TOOLS) {
    for (const key of t.inputSchema.required ?? []) {
      expect(Object.keys(t.inputSchema.properties)).toContain(key);
    }
  }
});
