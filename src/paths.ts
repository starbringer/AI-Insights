import { homedir } from "os";
import { join } from "path";
import { existsSync } from "node:fs";

function findClaudeBin(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    join(homedir(), ".local", "bin", `claude${ext}`),
    join(homedir(), "AppData", "Local", "Programs", "claude", `claude${ext}`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "claude";
}

export const CLAUDE_BIN = findClaudeBin();

export const CLAUDE_DIR = join(homedir(), ".claude");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
export const CLAUDE_JSON_PATH = join(homedir(), ".claude.json");
export const CLAUDE_DESKTOP_CONFIG_PATH = join(
  process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"),
  "Claude", "claude_desktop_config.json"
);
export const GLOBAL_CLAUDE_MD = join(CLAUDE_DIR, "CLAUDE.md");
export const SKILLS_DIR = join(CLAUDE_DIR, "skills");

export interface TranscriptPathInfo {
  isSubagent: boolean;
  parentAgentId: string | null;
}

/**
 * Classify a transcript file path as a top-level session or a sub-agent
 * transcript — WITHOUT ever mutating the path handed back to the filesystem.
 *
 * Sub-agent transcripts live at:
 *   .../<parent-agent-id>/subagents/agent-<id>.jsonl
 * so the directory segment immediately before "subagents" is the parent id.
 *
 * Separator matching happens on a COPY only: "\" is a legal filename character
 * on POSIX, so rewriting it into the real path makes statSync miss every file
 * on macOS/Linux (the exact bug this replaces). Normalizing every "\" to "/" on
 * the copy classifies both POSIX ("/"-separated) and Windows
 * ("C:\...\subagents\agent-x.jsonl") paths correctly.
 */
export function classifyTranscriptPath(realPath: string): TranscriptPathInfo {
  const segments = realPath.replace(/\\/g, "/").split("/");
  const subagentsIdx = segments.lastIndexOf("subagents");
  if (subagentsIdx <= 0) return { isSubagent: false, parentAgentId: null };
  return { isSubagent: true, parentAgentId: segments[subagentsIdx - 1] ?? null };
}

const SRC_DIR = import.meta.dir;
export const APP_DIR = join(SRC_DIR, "..");
export const DATA_DIR = join(APP_DIR, "data");
export const DB_PATH = join(DATA_DIR, "cache.db");
export const THRESHOLDS_PATH = join(DATA_DIR, "thresholds.json");
export const PRICING_PATH = join(DATA_DIR, "pricing.json");
export const STATIC_DIR = join(APP_DIR, "static");
