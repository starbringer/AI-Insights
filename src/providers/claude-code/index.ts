import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { PROJECTS_DIR } from "../../paths";
import { parseFileIncremental, scanAll, recomputeDerived } from "./parser";
import { loadAgentDetail } from "./agentDetail";
import { loadAgentTree } from "./agentTree";
import type { Provider, NormalizedTurn } from "../types";

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

// A single file change touches only files/turns/agents. The runs roll-up is a
// derived table, so it must be rebuilt afterwards or the Runs page stays frozen
// at whatever the last full scan produced. Debounce it: a burst of appends from
// one active session coalesces into a single rebuild once writes settle.
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRecompute(db: Database): void {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    try {
      recomputeDerived(db);
    } catch (err) {
      console.error("[claude-code] recompute failed:", err);
    }
  }, 500);
}

function ingestFile(db: Database, filePath: string): void {
  const normalized = filePath.replace(/\//g, "\\");
  const isSubagent = normalized.includes("\\subagents\\");
  let parentSessionId: string | null = null;

  if (isSubagent) {
    const parts = normalized.split("\\");
    const idx = parts.lastIndexOf("subagents");
    if (idx > 0) parentSessionId = parts[idx - 1] ?? null;
  }

  parseFileIncremental(db, normalized, isSubagent, parentSessionId);
  scheduleRecompute(db);
}

export const claudeCodeProvider: Provider = {
  id: "claude-code",
  label: "Claude Code",
  description: "Local JSONL transcripts under ~/.claude/projects/",
  dataDir: PROJECTS_DIR,
  hasData: () => existsSync(PROJECTS_DIR) && dirContainsJsonl(PROJECTS_DIR),
  watchGlobs: () => ["**/*.jsonl"],
  fileMatches: (path: string) => path.endsWith(".jsonl"),
  scanAll: (db: Database) => scanAll(db),
  ingestFile,
  loadAgentDetail: (agentId: string): NormalizedTurn[] => loadAgentDetail(agentId) as NormalizedTurn[],
  loadAgentTree: (agentId: string) => loadAgentTree(agentId),
};
