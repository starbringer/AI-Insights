import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./paths";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA synchronous = NORMAL");
  _db.run("PRAGMA foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    path             TEXT PRIMARY KEY,
    mtime            REAL NOT NULL DEFAULT 0,
    size             INTEGER NOT NULL DEFAULT 0,
    parsed_offset    INTEGER NOT NULL DEFAULT 0,
    session_id       TEXT,
    is_subagent      INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS turns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL,
    is_subagent      INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT,
    ts               TEXT NOT NULL,
    model            TEXT,
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_create_5m  INTEGER NOT NULL DEFAULT 0,
    cache_create_1h  INTEGER NOT NULL DEFAULT 0,
    cache_read       INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    service_tier     TEXT,
    raw_offset       INTEGER
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_ts      ON turns(ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_turns_model   ON turns(model)`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    session_id        TEXT PRIMARY KEY,
    is_subagent       INTEGER NOT NULL DEFAULT 0,
    parent_session_id TEXT,
    cwd               TEXT,
    project_flat      TEXT,
    title             TEXT,
    started_at        TEXT,
    last_seen_at      TEXT,
    turn_count        INTEGER NOT NULL DEFAULT 0,
    file_path         TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_cwd       ON sessions(cwd)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at)`);
}
