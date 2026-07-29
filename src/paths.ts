import { homedir } from "os";
import { dirname, join } from "path";
import { existsSync } from "node:fs";

/**
 * Where the Claude Code CLI lives. Installer layouts differ per platform, so
 * probe the known ones and fall back to the bare name (resolved via PATH).
 */
function findClaudeBin(): string {
  const home = homedir();
  const candidates = process.platform === "win32"
    ? [
        join(home, ".local", "bin", "claude.exe"),
        join(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
      ]
    : [
        join(home, ".local", "bin", "claude"),
        join(home, ".claude", "local", "claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
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

/**
 * Claude Desktop's config file. Each OS puts app config somewhere different:
 *   win32  → %APPDATA%\Claude\
 *   darwin → ~/Library/Application Support/Claude/
 *   linux  → $XDG_CONFIG_HOME/Claude/ (default ~/.config/Claude/)
 */
function claudeDesktopConfigDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), "Claude");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude");
  }
  return join(process.env["XDG_CONFIG_HOME"] ?? join(home, ".config"), "Claude");
}

export const CLAUDE_DESKTOP_CONFIG_PATH = join(claudeDesktopConfigDir(), "claude_desktop_config.json");
export const GLOBAL_CLAUDE_MD = join(CLAUDE_DIR, "CLAUDE.md");
export const SKILLS_DIR = join(CLAUDE_DIR, "skills");

/**
 * Comparison key for a filesystem path: case-folded on Windows so differently
 * cased spellings of one directory collapse, verbatim elsewhere so paths that
 * differ only in case stay the distinct directories they may really be.
 */
export function pathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

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

/**
 * App root — the directory holding `data/` and `static/`.
 *
 * Running from source that is the parent of src/. Inside a `bun build --compile`
 * binary, however, import.meta.dir points into the embedded virtual filesystem
 * ("B:\~BUN\root" on Windows, "/$bunfs/root" on macOS/Linux), and joining ".."
 * onto it yields the filesystem ROOT — so the first mkdir of data/ died with
 * EPERM/EACCES on every platform. That virtual dir does not exist on disk,
 * which is exactly how we detect the case; there, anchor to the executable, the
 * location the README already tells you to ship `static/` next to.
 */
const SRC_DIR = import.meta.dir;
export const APP_DIR = existsSync(SRC_DIR) ? join(SRC_DIR, "..") : dirname(process.execPath);
export const DATA_DIR = join(APP_DIR, "data");
export const DB_PATH = join(DATA_DIR, "cache.db");
export const THRESHOLDS_PATH = join(DATA_DIR, "thresholds.json");
export const RETENTION_PATH = join(DATA_DIR, "retention.json");
export const PRICING_PATH = join(DATA_DIR, "pricing.json");
export const STATIC_DIR = join(APP_DIR, "static");
/**
 * Assets this app installs into the AI tools it detects — currently the
 * usage-review skill. Resolved next to the executable exactly like `static/`,
 * so a compiled binary finds them as long as `assets/` ships alongside it.
 */
export const SKILL_ASSETS_DIR = join(APP_DIR, "assets", "skills");
