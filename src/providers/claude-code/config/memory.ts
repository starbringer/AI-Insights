import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { PROJECTS_DIR } from "../../../paths";
import type { MemoryStoreInfo, MemoryTopicInfo } from "../../../config/types";

const INDEX_RE = /^- \[(.+?)\]\((.+?)\)(?:\s*[—-]\s*(.+))?$/;

function parseIndex(content: string): { title: string; file: string; summary?: string }[] {
  const entries: { title: string; file: string; summary?: string }[] = [];
  for (const line of content.split("\n")) {
    const m = line.trim().match(INDEX_RE);
    if (m) entries.push({ title: m[1]!, file: m[2]!, summary: m[3]?.trim() });
  }
  return entries;
}

/**
 * Read one project's persistent memory: <projects>/<flat>/memory/MEMORY.md is
 * the index; every sibling *.md is a topic file. Topics referenced from the
 * index sort first (in index order), orphans follow alphabetically.
 */
function readStore(projectFlat: string, cwd: string | null): MemoryStoreInfo | null {
  const dir = join(PROJECTS_DIR, projectFlat, "memory");
  if (!existsSync(dir)) return null;

  let index: MemoryStoreInfo["index"] = [];
  let lastModifiedAt = new Date(0).toISOString();
  const indexPath = join(dir, "MEMORY.md");
  try {
    index = parseIndex(readFileSync(indexPath, "utf-8"));
    const t = statSync(indexPath).mtime.toISOString();
    if (t > lastModifiedAt) lastModifiedAt = t;
  } catch { /* missing index → empty */ }

  const order = new Map(index.map((e, i) => [e.file, i]));
  const topics: MemoryTopicInfo[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* ignore */ }
  for (const fname of names) {
    if (!fname.endsWith(".md") || fname === "MEMORY.md") continue;
    try {
      const fpath = join(dir, fname);
      const content = readFileSync(fpath, "utf-8");
      const modifiedAt = statSync(fpath).mtime.toISOString();
      if (modifiedAt > lastModifiedAt) lastModifiedAt = modifiedAt;
      topics.push({
        file: fname,
        title: index.find(e => e.file === fname)?.title ?? content.match(/^#{1,3} (.+)/m)?.[1],
        content,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        modifiedAt,
        referenced: order.has(fname),
      });
    } catch { /* skip unreadable */ }
  }

  topics.sort((a, b) => {
    const ia = order.get(a.file) ?? Infinity;
    const ib = order.get(b.file) ?? Infinity;
    return ia !== ib ? ia - ib : a.file.localeCompare(b.file);
  });

  return { projectKey: projectFlat, cwd, dir, index, topics, lastModifiedAt };
}

export function listMemoryStores(db: Database): MemoryStoreInfo[] {
  // Map the provider's flattened project dir names back to real cwds using
  // what the transcripts recorded — no lossy path decoding.
  const flatToCwd = new Map<string, string>();
  const rows = db.query<{ project_flat: string; cwd: string }, []>(
    `SELECT DISTINCT project_flat, cwd FROM agents
     WHERE project_flat IS NOT NULL AND cwd IS NOT NULL`
  ).all();
  for (const r of rows) if (!flatToCwd.has(r.project_flat)) flatToCwd.set(r.project_flat, r.cwd);

  const stores: MemoryStoreInfo[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(PROJECTS_DIR); } catch { return []; }
  for (const flat of dirs) {
    try {
      const store = readStore(flat, flatToCwd.get(flat) ?? null);
      if (store) stores.push(store);
    } catch { /* skip broken store */ }
  }
  return stores.sort((a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt));
}
