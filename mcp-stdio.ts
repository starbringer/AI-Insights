#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { DATA_DIR } from "./src/paths";
import { getDb } from "./src/db";
import { PROVIDERS } from "./src/providers";
import { getRetentionDays, pruneOldData } from "./src/retention";
import { handleMessage, expectsResponse, SERVER_NAME, SERVER_VERSION } from "./src/mcp/protocol";

// ============================================================================
// AI Insights MCP server — stdio transport.
//
// The dashboard already serves MCP over HTTP at /mcp, which is the recommended
// way to connect (one process, one command). This entry point exists for
// clients that only speak stdio.
//
// It is fully standalone: it opens the same SQLite cache and, unless --no-scan
// is passed, refreshes it from the transcripts on startup, so it works whether
// or not the dashboard is running. The two processes coexist through SQLite's
// WAL mode and busy timeout.
//
// Hard rule of the stdio transport: stdout carries newline-delimited JSON-RPC
// and NOTHING else. Every log line goes to stderr.
// ============================================================================

const argv = Bun.argv.slice(2);
const NO_SCAN = argv.includes("--no-scan");

const log = (msg: string) => process.stderr.write(`[${SERVER_NAME}-mcp] ${msg}\n`);

mkdirSync(DATA_DIR, { recursive: true });
const db = getDb();

if (NO_SCAN) {
  log("starting without a transcript scan (--no-scan); reading the existing cache");
} else {
  log("scanning transcript files…");
  for (const provider of PROVIDERS) {
    if (!provider.hasData()) continue;
    try {
      provider.scanAll(db);
    } catch (e) {
      // A provider that fails to scan must not take the whole server down —
      // the cached data from previous runs is still worth serving.
      log(`provider "${provider.id}" failed to scan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log("scan complete");
}

// Enforce the retention window here too: this entry point can be the only
// process that ever touches the cache on a machine where the dashboard is
// never started.
try {
  const pruned = pruneOldData(db);
  log(`retention: keeping ${getRetentionDays()} days (pruned ${pruned.turns} turns, ${pruned.events} events)`);
} catch (e) {
  log(`retention sweep failed: ${e instanceof Error ? e.message : String(e)}`);
}

log(`v${SERVER_VERSION} ready on stdio (${PROVIDERS.length} provider(s) registered)`);

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Process one inbound line. Messages are handled without awaiting each other so
 * a slow tool call cannot block the next request, and responses carry their own
 * ids, so out-of-order delivery is fine.
 */
function dispatch(line: string): void {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "invalid JSON" } });
    return;
  }

  const messages = Array.isArray(msg) ? msg : [msg];
  for (const m of messages) {
    void handleMessage(m)
      .then(response => {
        if (response && expectsResponse(m)) send(response);
      })
      .catch(e => log(`handler error: ${e instanceof Error ? e.message : String(e)}`));
  }
}

// Newline-delimited framing: buffer partial reads and emit complete lines only.
let buffer = "";
const decoder = new TextDecoder();

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk as Uint8Array, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) dispatch(line);
    newline = buffer.indexOf("\n");
  }
}

// stdin closed: the client is gone.
const trailing = buffer.trim();
if (trailing) dispatch(trailing);
log("stdin closed, exiting");
