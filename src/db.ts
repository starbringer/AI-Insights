import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./paths";

const SCHEMA_VERSION = 8;

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA synchronous = NORMAL");
  _db.run("PRAGMA foreign_keys = ON");
  // Wait instead of throwing SQLITE_BUSY when another process (a second
  // server instance) briefly holds the write lock.
  _db.run("PRAGMA busy_timeout = 5000");

  const existing = (_db.query<{ user_version: number }, []>("PRAGMA user_version").get())?.user_version ?? 0;
  if (existing !== SCHEMA_VERSION) {
    // Drop everything from prior versions; the DB is a regenerable cache.
    _db.run("DROP TABLE IF EXISTS files");
    _db.run("DROP TABLE IF EXISTS turns");
    _db.run("DROP TABLE IF EXISTS sessions");
    _db.run("DROP TABLE IF EXISTS agents");
    _db.run("DROP TABLE IF EXISTS runs");
    _db.run("DROP TABLE IF EXISTS events");
  }

  initSchema(_db);
  _db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return _db;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    path             TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,
    mtime            REAL NOT NULL DEFAULT 0,
    size             INTEGER NOT NULL DEFAULT 0,
    parsed_offset    INTEGER NOT NULL DEFAULT 0,
    agent_id         TEXT,
    is_subagent      INTEGER NOT NULL DEFAULT 0,
    parent_agent_id  TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS runs (
    run_id           TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,
    project_flat     TEXT,
    cwd              TEXT,
    title            TEXT,
    started_at       TEXT,
    last_seen_at     TEXT,
    agent_count      INTEGER NOT NULL DEFAULT 1,
    turn_count       INTEGER NOT NULL DEFAULT 0
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_last_seen ON runs(last_seen_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_cwd       ON runs(cwd)`);

  db.run(`CREATE TABLE IF NOT EXISTS agents (
    agent_id          TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    run_id            TEXT NOT NULL,
    is_subagent       INTEGER NOT NULL DEFAULT 0,
    parent_agent_id   TEXT,
    parent_turn_index INTEGER,
    agent_type        TEXT,
    description       TEXT,
    cwd               TEXT,
    project_flat      TEXT,
    title             TEXT,
    started_at        TEXT,
    last_seen_at      TEXT,
    turn_count        INTEGER NOT NULL DEFAULT 0,
    file_path         TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_run       ON agents(run_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_parent    ON agents(parent_agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_cwd       ON agents(cwd)`);

  db.run(`CREATE TABLE IF NOT EXISTS turns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    provider         TEXT NOT NULL,
    agent_id         TEXT NOT NULL,
    run_id           TEXT NOT NULL,
    is_subagent      INTEGER NOT NULL DEFAULT 0,
    parent_agent_id  TEXT,
    message_id       TEXT,
    request_id       TEXT,
    ts               TEXT NOT NULL,
    model            TEXT,
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_create_5m  INTEGER NOT NULL DEFAULT 0,
    cache_create_1h  INTEGER NOT NULL DEFAULT 0,
    cache_read       INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    service_tier     TEXT,
    raw_offset       INTEGER,
    bucket           INTEGER NOT NULL DEFAULT 0
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_run   ON turns(run_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_ts    ON turns(ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model)`);
  // One row per API response: Claude Code writes one JSONL line per content
  // block, all sharing the same message.id and repeating the same usage.
  // Without this dedupe every token count would be multiplied by the block
  // count (~2.4x observed).
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_msg ON turns(agent_id, message_id)`);
  // `bucket` classifies each API call for cost attribution (0=base, 1=mcp,
  // 2=skill; sub-agent turns are attributed by is_subagent instead). Assigned
  // at parse time from the call's tool_use blocks; conflicts keep the highest
  // priority seen across the response's lines.

  // Lightweight event stream extracted from transcripts: real user prompts,
  // tool calls, hook fires, API errors, compactions, model fallbacks.
  // Powers the audit page with recorded counts instead of guesses.
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider    TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    ts          TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- prompt | tool | hook | api_error | compact | fallback
    detail      TEXT,            -- tool name / hook command / error status / …
    dedupe      TEXT,            -- source uuid: makes incremental re-parses idempotent
    tool_use_id TEXT,            -- provider's tool call id: links tool_result back to its call
    tokens      INTEGER NOT NULL DEFAULT 0,  -- est. tokens of tool input + result (chars/4)
    extra       TEXT             -- skill name for Skill tool calls
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe ON events(agent_id, dedupe)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_tool_use ON events(agent_id, tool_use_id)`);
}
