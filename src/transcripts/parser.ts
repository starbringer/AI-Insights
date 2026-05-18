import { openSync, readSync, closeSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { extractTitle } from "./titles";
import { getFileRecord, upsertFile, insertTurn, upsertSession } from "./cache";
import type { FileRecord, SessionRecord } from "./cache";
import { PROJECTS_DIR } from "../paths";

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
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
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
  sessionId: string | null;
  cwd: string | null;
  projectFlat: string | null;
  title: string | null;
  titleSet: boolean;
  startedAt: string | null;
  lastTs: string | null;
  turnCount: number;
}

function flatToProject(flat: string): string {
  return flat.replace(/--/g, "\\");
}

export function parseFileIncremental(
  db: Database,
  filePath: string,
  isSubagent: boolean,
  parentSessionId: string | null,
): void {
  const stat = statSync(filePath, { throwIfNoEntry: false });
  if (!stat) return;

  const record = getFileRecord(db, filePath);
  if (record && record.mtime === stat.mtimeMs && record.size === stat.size) return;

  const startOffset = record?.parsed_offset ?? 0;
  const ctx: ParseCtx = {
    sessionId: record?.session_id ?? null,
    cwd: null,
    projectFlat: null,
    title: null,
    titleSet: startOffset > 0,
    startedAt: null,
    lastTs: null,
    turnCount: 0,
  };

  if (startOffset >= stat.size) {
    upsertFile(db, { path: filePath, mtime: stat.mtimeMs, size: stat.size,
      parsed_offset: startOffset, session_id: ctx.sessionId,
      is_subagent: isSubagent ? 1 : 0, parent_session_id: parentSessionId });
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

  let lineOffset = startOffset;
  for (const rawLine of completeText.split("\n")) {
    const lineBytes = Buffer.byteLength(rawLine, "utf-8") + 1;
    const trimmed = rawLine.trim();
    if (trimmed) {
      try {
        processLine(db, JSON.parse(trimmed) as RawLine, ctx, lineOffset,
          filePath, isSubagent, parentSessionId);
      } catch { /* malformed JSON — skip */ }
    }
    lineOffset += lineBytes;
  }

  if (ctx.sessionId) {
    const projectFlat = ctx.projectFlat ?? basename(dirname(isSubagent ? dirname(dirname(filePath)) : dirname(filePath)));
    upsertSession(db, {
      session_id: ctx.sessionId,
      is_subagent: isSubagent ? 1 : 0,
      parent_session_id: parentSessionId,
      cwd: ctx.cwd,
      project_flat: projectFlat,
      title: ctx.title,
      started_at: ctx.startedAt,
      last_seen_at: ctx.lastTs,
      turn_count: ctx.turnCount,
      file_path: filePath,
    } as SessionRecord);
  }

  upsertFile(db, {
    path: filePath,
    mtime: stat.mtimeMs,
    size: stat.size,
    parsed_offset: newOffset,
    session_id: ctx.sessionId,
    is_subagent: isSubagent ? 1 : 0,
    parent_session_id: parentSessionId,
  } as FileRecord);
}

function processLine(
  db: Database,
  line: RawLine,
  ctx: ParseCtx,
  rawOffset: number,
  filePath: string,
  isSubagent: boolean,
  parentSessionId: string | null,
): void {
  if (!line.type) return;

  if (line.sessionId && !ctx.sessionId) {
    ctx.sessionId = line.sessionId;
  }
  if (line.cwd && !ctx.cwd) {
    ctx.cwd = line.cwd;
  }
  if (line.timestamp) {
    if (!ctx.startedAt) ctx.startedAt = line.timestamp;
    ctx.lastTs = line.timestamp;
  }

  if (line.type === "user" && !ctx.titleSet && line.message?.content) {
    ctx.title = extractTitle(line.message.content);
    ctx.titleSet = true;
  }

  if (line.type === "assistant" && line.message?.usage && line.sessionId) {
    const u = line.message.usage;
    const cw5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    const cw1h = u.cache_creation?.ephemeral_1h_input_tokens
      ?? (u.cache_creation_input_tokens ?? 0);

    insertTurn(db, {
      session_id: line.sessionId,
      is_subagent: isSubagent ? 1 : 0,
      parent_session_id: parentSessionId,
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
    let parentSessionId: string | null = null;

    if (isSubagent) {
      const parts = normalized.split("\\");
      const subagentsIdx = parts.lastIndexOf("subagents");
      if (subagentsIdx > 0) {
        parentSessionId = parts[subagentsIdx - 1] ?? null;
      }
    }

    parseFileIncremental(db, normalized, isSubagent, parentSessionId);
  }
}
