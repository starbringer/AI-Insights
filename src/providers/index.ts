import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_DIR } from "../paths";

export interface Provider {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData(): boolean;
}

function dirContainsJsonl(dir: string, depthBudget = 4): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (depthBudget > 0 && dirContainsJsonl(join(dir, entry.name), depthBudget - 1)) return true;
      } else if (entry.name.endsWith(".jsonl")) {
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

export const PROVIDERS: Provider[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Local JSONL transcripts under ~/.claude/projects/",
    dataDir: PROJECTS_DIR,
    hasData: () => existsSync(PROJECTS_DIR) && dirContainsJsonl(PROJECTS_DIR),
  },
];

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData: boolean;
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    description: p.description,
    dataDir: p.dataDir,
    hasData: p.hasData(),
  }));
}
