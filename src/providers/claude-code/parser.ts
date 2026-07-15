import { openSync, readSync, closeSync, statSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { extractTitle } from "./titles";
import { getFileRecord, upsertFile, insertTurn, insertEvent, upsertAgent } from "../../transcripts/cache";
import type { FileRecord, AgentRecord } from "../../transcripts/cache";
import { PROJECTS_DIR } from "../../paths";
import { resolveRunIdsForProvider, refreshRuns, recomputeAgentActivity } from "../../transcripts/runs";

const PROVIDER_ID = "claude-code";

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findJsonlFiles(full));
      else if (entry.name.endsWith(".jsonl")) results.push(full);
    }
  } catch { /* skip inaccessible */ }
  return results;
}

interface RawLine {
  type?: string;
  subtype?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  requestId?: string;
  isApiErrorMessage?: boolean;
  isMeta?: boolean;
  aiTitle?: string;
  sourceToolUseID?: string;
  hookInfos?: { command?: string }[];
  error?: { status?: number; formatted?: string; message?: string };
  originalModel?: string;
  fallbackModel?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
      output_tokens?: number;
      service_tier?: string;
    };
  };
}

interface ParseCtx {
  agentId: string | null;
  cwd: string | null;
  projectFlat: string | null;
  title: string | null;
  titleSet: boolean;
  startedAt: string | null;
  lastTs: string | null;
  turnCount: number;
}

function readSubagentMeta(jsonlPath: string): { agent_type: string | null; description: string | null } {
  // Sibling file: <jsonlPath without .jsonl>.meta.json
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  if (!existsSync(metaPath)) return { agent_type: null, description: null };
  try {
    const raw = readFileSync(metaPath, "utf-8");
    const json = JSON.parse(raw) as { agentType?: string; description?: string };
    return { agent_type: json.agentType ?? null, description: json.description ?? null };
  } catch {
    return { agent_type: null, description: null };
  }
}

export function parseFileIncremental(
  db: Database,
  filePath: string,
  isSubagent: boolean,
  parentAgentId: string | null,
): void {
  const stat = statSync(filePath, { throwIfNoEntry: false });
  if (!stat) return;

  // IMPORTANT: derive agent_id from the file name, NOT from the in-line `sessionId`.
  // Claude Code writes the PARENT's sessionId inside a sub-agent's JSONL (with
  // isSidechain=true to distinguish), so using line.sessionId would collapse
  // every sub-agent into its parent's row.
  // Top-level transcript:  <agent-id>.jsonl              → agent-id = file stem
  // Sub-agent transcript:  subagents/agent-<agent-id>.jsonl → strip 'agent-' prefix
  const fileStem = basename(filePath).replace(/\.jsonl$/, "");
  const agentIdFromFile = isSubagent ? fileStem.replace(/^agent-/, "") : fileStem;

  const record = getFileRecord(db, filePath);
  if (record && record.mtime === stat.mtimeMs && record.size === stat.size) return;

  const startOffset = record?.parsed_offset ?? 0;
  const ctx: ParseCtx = {
    agentId: agentIdFromFile,
    cwd: null,
    projectFlat: null,
    title: null,
    titleSet: startOffset > 0,
    startedAt: null,
    lastTs: null,
    turnCount: 0,
  };

  if (startOffset >= stat.size) {
    upsertFile(db, { path: filePath, provider: PROVIDER_ID, mtime: stat.mtimeMs, size: stat.size,
      parsed_offset: startOffset, agent_id: ctx.agentId,
      is_subagent: isSubagent ? 1 : 0, parent_agent_id: parentAgentId });
    return;
  }

  const newBytes = stat.size - startOffset;
  const buf = Buffer.allocUnsafe(newBytes);
  const fd = openSync(filePath, "r");
  readSync(fd, buf, 0, newBytes, startOffset);
  closeSync(fd);

  const text = buf.toString("utf-8");
  const lastNl = text.lastIndexOf("\n");
  const completeText = lastNl === -1 ? "" : text.slice(0, lastNl + 1);
  const newOffset = startOffset + Buffer.byteLength(completeText, "utf-8");

  // Provisional run_id: parent's id if subagent, otherwise our own. The real
  // root is resolved later by resolveRunIdsForProvider walking parent chains.
  const provisionalRunId: string = parentAgentId ?? agentIdFromFile;

  let lineOffset = startOffset;
  for (const rawLine of completeText.split("\n")) {
    const lineBytes = Buffer.byteLength(rawLine, "utf-8") + 1;
    const trimmed = rawLine.trim();
    if (trimmed) {
      try {
        const line = JSON.parse(trimmed) as RawLine;
        processLine(db, line, ctx, lineOffset, isSubagent, parentAgentId, provisionalRunId, agentIdFromFile);
      } catch { /* malformed JSON — skip */ }
    }
    lineOffset += lineBytes;
  }

  if (ctx.agentId) {
    // projects/<flat>/<agent>.jsonl  → flat = parent dir of the file
    // projects/<flat>/<parent>/subagents/agent-<id>.jsonl → three levels up
    const projectFlat = ctx.projectFlat ?? basename(isSubagent
      ? dirname(dirname(dirname(filePath)))
      : dirname(filePath));
    const meta = isSubagent ? readSubagentMeta(filePath) : { agent_type: null, description: null };
    upsertAgent(db, {
      agent_id: ctx.agentId,
      provider: PROVIDER_ID,
      run_id: provisionalRunId ?? ctx.agentId,
      is_subagent: isSubagent ? 1 : 0,
      parent_agent_id: parentAgentId,
      parent_turn_index: null,
      agent_type: meta.agent_type,
      description: meta.description,
      cwd: ctx.cwd,
      project_flat: projectFlat,
      title: ctx.title,
      started_at: ctx.startedAt,
      last_seen_at: ctx.lastTs,
      turn_count: ctx.turnCount,
      file_path: filePath,
    } as AgentRecord);
  }

  upsertFile(db, {
    path: filePath,
    provider: PROVIDER_ID,
    mtime: stat.mtimeMs,
    size: stat.size,
    parsed_offset: newOffset,
    agent_id: ctx.agentId,
    is_subagent: isSubagent ? 1 : 0,
    parent_agent_id: parentAgentId,
  } as FileRecord);
}

function processLine(
  db: Database,
  line: RawLine,
  ctx: ParseCtx,
  rawOffset: number,
  isSubagent: boolean,
  parentAgentId: string | null,
  runId: string,
  agentId: string,
): void {
  if (!line.type) return;

  const emit = (kind: "prompt" | "tool" | "hook" | "api_error" | "compact" | "fallback",
                detail: string | null, dedupe: string) => {
    insertEvent(db, {
      provider: PROVIDER_ID, agent_id: agentId, run_id: runId,
      ts: line.timestamp ?? new Date().toISOString(),
      kind, detail, dedupe,
    });
  };

  // Real user prompts (not tool-result echoes, not framework-injected content)
  if (line.type === "user" && !line.isMeta && !line.sourceToolUseID && line.uuid) {
    const c = line.message?.content;
    const isToolResultOnly = Array.isArray(c) && c.length > 0 &&
      (c as Record<string, unknown>[]).every(b => b["type"] === "tool_result");
    const hasText = typeof c === "string"
      ? c.trim().length > 0
      : Array.isArray(c) && (c as Record<string, unknown>[]).some(
          b => b["type"] === "text" && String(b["text"] ?? "").trim());
    if (!isToolResultOnly && hasText) emit("prompt", null, line.uuid);
  }

  // Tool calls (one content block per assistant line, but stay defensive)
  if (line.type === "assistant" && line.uuid && Array.isArray(line.message?.content)) {
    const blocks = line.message.content as Record<string, unknown>[];
    blocks.forEach((b, i) => {
      if (b["type"] === "tool_use") {
        emit("tool", String(b["name"] ?? "unknown"), `${line.uuid}:${i}`);
      }
    });
  }

  // Framework events
  if (line.type === "system" && line.uuid) {
    if (line.subtype === "stop_hook_summary") {
      emit("hook", line.hookInfos?.map(h => h.command ?? "?").join("; ") ?? null, line.uuid);
    } else if (line.subtype === "api_error") {
      emit("api_error", line.error?.formatted ?? String(line.error?.status ?? ""), line.uuid);
    } else if (line.subtype === "compact_boundary") {
      emit("compact", null, line.uuid);
    } else if (line.subtype === "model_refusal_fallback") {
      emit("fallback", `${line.originalModel ?? "?"} -> ${line.fallbackModel ?? "?"}`, line.uuid);
    }
  }
  if (line.type === "assistant" && line.uuid && (line.isApiErrorMessage || line.message?.model === "<synthetic>")) {
    emit("api_error", "synthetic", line.uuid);
  }

  if (line.cwd && !ctx.cwd) {
    ctx.cwd = line.cwd;
  }
  if (line.timestamp) {
    if (!ctx.startedAt) ctx.startedAt = line.timestamp;
    ctx.lastTs = line.timestamp;
  }

  // Title priority: AI-generated session title (ai-title lines, may appear
  // several times — the last one wins) > first meaningful user prompt.
  if (line.type === "ai-title" && line.aiTitle?.trim()) {
    ctx.title = line.aiTitle.trim();
    ctx.titleSet = true;
  }
  if (line.type === "user" && !ctx.titleSet && !line.isMeta && line.message?.content) {
    // extractTitle returns null for pure framework noise (IDE state,
    // command caveats) — keep looking at later user lines in that case.
    const t = extractTitle(line.message.content);
    if (t) { ctx.title = t; ctx.titleSet = true; }
  }

  if (line.type === "assistant" && line.message?.usage) {
    // Failed API calls are echoed as assistant lines with model "<synthetic>"
    // and zero usage — they are not real turns and would pollute turn counts
    // and the model list.
    if (line.isApiErrorMessage || line.message.model === "<synthetic>") return;

    const u = line.message.usage;
    // Prefer the per-TTL breakdown. When only the legacy total is present,
    // attribute it to the 5m bucket — that is the default cache TTL, and
    // pricing it as 1h would overstate cost (2x vs 1.25x input price).
    const cw5m = u.cache_creation?.ephemeral_5m_input_tokens
      ?? (u.cache_creation_input_tokens ?? 0);
    const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;

    insertTurn(db, {
      provider: PROVIDER_ID,
      agent_id: agentId,
      run_id: runId,
      is_subagent: isSubagent ? 1 : 0,
      parent_agent_id: parentAgentId,
      message_id: line.message.id ?? null,
      request_id: line.requestId ?? null,
      ts: line.timestamp ?? new Date().toISOString(),
      model: line.message.model ?? null,
      input_tokens: u.input_tokens ?? 0,
      cache_create_5m: cw5m,
      cache_create_1h: cw1h,
      cache_read: u.cache_read_input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      service_tier: u.service_tier ?? null,
      raw_offset: rawOffset,
    });
    ctx.turnCount++;
  }
}

export function scanAll(db: Database): void {
  if (!statSync(PROJECTS_DIR, { throwIfNoEntry: false })?.isDirectory()) return;

  const rawFiles = findJsonlFiles(PROJECTS_DIR);

  for (const f of rawFiles) {
    const normalized = f.replace(/\//g, "\\");
    const isSubagent = normalized.includes("\\subagents\\");
    let parentAgentId: string | null = null;

    if (isSubagent) {
      const parts = normalized.split("\\");
      const subagentsIdx = parts.lastIndexOf("subagents");
      if (subagentsIdx > 0) {
        parentAgentId = parts[subagentsIdx - 1] ?? null;
      }
    }

    parseFileIncremental(db, normalized, isSubagent, parentAgentId);
  }

  recomputeDerived(db);
}

/**
 * Rebuild the derived tables from the current agents/turns rows:
 *   1. resolve every agent's true run_id by walking parent chains,
 *   2. compute sub-agents' parent_turn_index for detail-page ordering,
 *   3. roll up the runs table.
 *
 * Idempotent. Run once at the end of a full scan AND after every incremental
 * ingest (see the provider's ingestFile) so the runs table — and therefore the
 * Runs page — stays current without restarting the server.
 */
export function recomputeDerived(db: Database): void {
  resolveRunIdsForProvider(db, PROVIDER_ID);
  computeSubagentTurnIndex(db);
  recomputeAgentActivity(db, PROVIDER_ID);
  refreshRuns(db, PROVIDER_ID);
}

/**
 * For every Claude Code sub-agent, find the index of its corresponding
 * Task tool_use call inside the parent's JSONL and store it in
 * agents.parent_turn_index. Used to order siblings on the detail page.
 */
function computeSubagentTurnIndex(db: Database): void {
  const subagents = db.query<{ agent_id: string; parent_agent_id: string; description: string | null }, []>(
    `SELECT agent_id, parent_agent_id, description FROM agents
     WHERE provider='${PROVIDER_ID}' AND is_subagent=1 AND parent_agent_id IS NOT NULL`
  ).all();
  if (subagents.length === 0) return;

  // Group by parent so we read each parent JSONL only once.
  const byParent = new Map<string, typeof subagents>();
  for (const s of subagents) {
    const list = byParent.get(s.parent_agent_id) ?? [];
    list.push(s);
    byParent.set(s.parent_agent_id, list);
  }

  for (const [parentId, children] of byParent) {
    const parentFile = db.query<{ file_path: string | null }, [string]>(
      `SELECT file_path FROM agents WHERE agent_id = ?`
    ).get(parentId)?.file_path;
    if (!parentFile) continue;

    const taskCalls = extractTaskCalls(parentFile);
    if (taskCalls.length === 0) continue;

    // Match each child to a Task call by description (Claude Code passes the
    // subagent's `description` arg through to meta.json). Fallback: assign
    // remaining children sequentially by file mtime.
    const remaining = taskCalls.map((c, i) => ({ ...c, index: i }));
    const sortedChildren = [...children].sort((a, b) => a.agent_id.localeCompare(b.agent_id));
    for (const child of sortedChildren) {
      let matchIdx = -1;
      if (child.description) {
        matchIdx = remaining.findIndex(t => t.description === child.description);
      }
      if (matchIdx === -1) matchIdx = 0;
      const match = remaining.splice(matchIdx, 1)[0];
      if (!match) continue;
      db.run(
        `UPDATE agents SET parent_turn_index = ? WHERE agent_id = ?`,
        [match.index, child.agent_id]
      );
    }
  }
}

interface TaskCall { description: string | null; index: number }

function extractTaskCalls(jsonlPath: string): TaskCall[] {
  const calls: TaskCall[] = [];
  try {
    const raw = readFileSync(jsonlPath, "utf-8");
    let idx = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { type?: string; message?: { content?: unknown } };
        if (obj.type !== "assistant") continue;
        const content = obj.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content as Record<string, unknown>[]) {
          if (block["type"] === "tool_use" && block["name"] === "Task") {
            const input = block["input"] as Record<string, unknown> | undefined;
            const desc = input?.["description"];
            calls.push({ description: typeof desc === "string" ? desc : null, index: idx++ });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return calls;
}
