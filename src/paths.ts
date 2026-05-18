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

const SRC_DIR = import.meta.dir;
export const APP_DIR = join(SRC_DIR, "..");
export const DATA_DIR = join(APP_DIR, "data");
export const DB_PATH = join(DATA_DIR, "cache.db");
export const THRESHOLDS_PATH = join(DATA_DIR, "thresholds.json");
export const PRICING_PATH = join(DATA_DIR, "pricing.json");
export const STATIC_DIR = join(APP_DIR, "static");
