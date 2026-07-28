import { Hono } from "hono";
import {
  ERROR_CODES, LATEST_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS, expectsResponse, handleMessage,
} from "../mcp/protocol";
import { MCP_TOOLS } from "../mcp/tools";

// ============================================================================
// /mcp — the Model Context Protocol endpoint, Streamable HTTP transport.
//
// Mounted on the same Hono app as the dashboard, so `bun run start` brings the
// UI and the MCP server up together on one port. No second process, no Docker.
//
// Stateless: no Mcp-Session-Id is issued and every POST is answered with a
// single `application/json` body rather than an SSE stream. Both are explicitly
// allowed by the spec, and neither costs us anything — the server holds no
// per-client state and never initiates messages.
//
// GET and DELETE answer 405, which is the spec's way of saying "this endpoint
// offers no server-initiated stream" and "this server has no sessions to end".
// ============================================================================

export const mcpRouter = new Hono();

/**
 * Reject cross-origin browser requests (DNS-rebinding defence, mandated by the
 * transport spec). Native MCP clients send no Origin header at all, which is
 * allowed through; a hostile web page cannot suppress the header, so anything
 * that arrives with a non-loopback Origin is rejected.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

mcpRouter.use("*", async (c, next) => {
  if (!originAllowed(c.req.header("origin"))) {
    return c.json({ error: "cross-origin requests are not allowed on the MCP endpoint" }, 403);
  }
  // A client that negotiated a revision we don't speak must be told so rather
  // than silently served a shape it may not understand.
  const version = c.req.header("mcp-protocol-version");
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return c.json({
      error: `unsupported MCP-Protocol-Version "${version}" — supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
    }, 400);
  }
  await next();
});

mcpRouter.post("/", async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({
      jsonrpc: "2.0", id: null,
      error: { code: ERROR_CODES.parseError, message: "invalid JSON" },
    }, 400);
  }

  // Batching was removed in 2025-06-18 but older clients may still send arrays;
  // handling both costs one branch.
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(handleMessage))).filter(r => r !== null);
    if (responses.length === 0) return c.body(null, 202);
    return c.json(responses);
  }

  if (!expectsResponse(body)) {
    await handleMessage(body);
    return c.body(null, 202);
  }

  const response = await handleMessage(body);
  if (!response) return c.body(null, 202);
  return c.json(response);
});

// No server-initiated stream and no sessions to terminate.
mcpRouter.get("/", c => c.text("This MCP endpoint does not offer an SSE stream; POST JSON-RPC instead.", 405));
mcpRouter.delete("/", c => c.text("This MCP server is stateless; there is no session to delete.", 405));

/**
 * Human-readable sibling of the protocol endpoint, for checking the server is
 * up and seeing what it exposes without speaking JSON-RPC.
 */
export const mcpInfoRouter = new Hono();

mcpInfoRouter.get("/", c => c.json({
  server: { name: SERVER_NAME, version: SERVER_VERSION },
  endpoint: "/mcp",
  transport: "streamable-http",
  protocolVersion: LATEST_PROTOCOL_VERSION,
  supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  readOnly: true,
  toolCount: MCP_TOOLS.length,
  tools: MCP_TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description })),
}));
