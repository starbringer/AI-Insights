import type { Database } from "bun:sqlite";

export interface FileRecord {
  path: string;
  mtime: number;
  size: number;
  parsed_offset: number;
  session_id: string | null;
  is_subagent: number;
  parent_session_id: string | null;
}

export interface TurnRecord {
  session_id: string;
  is_subagent: number;
  parent_session_id: string | null;
  ts: string;
  model: string | null;
  input_tokens: number;
  cache_create_5m: number;
  cache_create_1h: number;
  cache_read: number;
  output_tokens: number;
  service_tier: string | null;
  raw_offset: number | null;
}

export interface SessionRecord {
  session_id: string;
  is_subagent: number;
  parent_session_id: string | null;
  cwd: string | null;
  project_flat: string | null;
  title: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  turn_count: number;
  file_path: string | null;
}

export function getFileRecord(db: Database, path: string): FileRecord | null {
  return db.query<FileRecord, [string]>(
    "SELECT * FROM files WHERE path = ?"
  ).get(path);
}

export function upsertFile(db: Database, r: FileRecord): void {
  db.run(
    `INSERT INTO files(path,mtime,size,parsed_offset,session_id,is_subagent,parent_session_id)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET
       mtime=excluded.mtime, size=excluded.size,
       parsed_offset=excluded.parsed_offset,
       session_id=COALESCE(excluded.session_id, session_id),
       is_subagent=excluded.is_subagent,
       parent_session_id=excluded.parent_session_id`,
    [r.path, r.mtime, r.size, r.parsed_offset, r.session_id, r.is_subagent, r.parent_session_id]
  );
}

export function insertTurn(db: Database, t: TurnRecord): void {
  db.run(
    `INSERT INTO turns
       (session_id,is_subagent,parent_session_id,ts,model,
        input_tokens,cache_create_5m,cache_create_1h,cache_read,
        output_tokens,service_tier,raw_offset)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [t.session_id, t.is_subagent, t.parent_session_id, t.ts, t.model,
     t.input_tokens, t.cache_create_5m, t.cache_create_1h, t.cache_read,
     t.output_tokens, t.service_tier, t.raw_offset]
  );
}

export function upsertSession(db: Database, s: SessionRecord): void {
  db.run(
    `INSERT INTO sessions
       (session_id,is_subagent,parent_session_id,cwd,project_flat,
        title,started_at,last_seen_at,turn_count,file_path)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       cwd=COALESCE(excluded.cwd, cwd),
       project_flat=COALESCE(excluded.project_flat, project_flat),
       title=COALESCE(title, excluded.title),
       started_at=COALESCE(started_at, excluded.started_at),
       last_seen_at=excluded.last_seen_at,
       turn_count=excluded.turn_count,
       file_path=COALESCE(file_path, excluded.file_path)`,
    [s.session_id, s.is_subagent, s.parent_session_id, s.cwd, s.project_flat,
     s.title, s.started_at, s.last_seen_at, s.turn_count, s.file_path]
  );
}
