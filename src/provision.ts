import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { SKILL_ASSETS_DIR } from "./paths";
import { CONFIG_ADAPTERS } from "./config";
import type { ProvisionResult, SkillPackage } from "./config/types";
import { SERVER_NAME } from "./mcp/protocol";

// ============================================================================
// Startup provisioning — provider-agnostic.
//
// On every start the app makes itself usable from whichever AI coding tools are
// installed on this machine: it copies the bundled usage-review skill into each
// tool's user-scope skill directory and registers the local MCP endpoint with
// it. Both steps are idempotent, so this is a no-op from the second run on.
//
// Nothing here knows about Claude Code. It loops the config-adapter registry and
// calls whatever provisioning hooks each adapter implements; a future Codex or
// OpenCode adapter is picked up automatically by implementing them.
// ============================================================================

export interface ProvisionReport {
  providerId: string;
  displayName: string;
  skill?: ProvisionResult;
  mcp?: ProvisionResult;
}

/**
 * Read a skill package off disk.
 *
 * Skill assets ship as real markdown files next to the app (the same deal as
 * `static/`) so they stay editable and reviewable, rather than being inlined
 * into TypeScript string literals.
 */
export function loadSkillPackage(name: string): SkillPackage | null {
  const root = join(SKILL_ASSETS_DIR, name);
  if (!existsSync(join(root, "SKILL.md"))) return null;

  const files: SkillPackage["files"] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      // Forward slashes: relPath is a portable identifier that the installer
      // re-joins with the platform separator on the far side.
      files.push({ relPath: relative(root, full).replace(/\\/g, "/"), content: readFileSync(full, "utf-8") });
    }
  };
  walk(root);

  return { name, files };
}

/** Skills this app ships and keeps installed in every detected tool. */
export const BUNDLED_SKILLS = ["ai-usage-review"];

export interface ProvisionOptions {
  /** URL of this app's MCP endpoint, e.g. http://127.0.0.1:5757/mcp */
  mcpUrl: string;
  /** Skip MCP registration (skills are still installed). */
  skipMcp?: boolean;
  /** Skip skill installation (MCP is still registered). */
  skipSkills?: boolean;
}

export async function provision(opts: ProvisionOptions): Promise<ProvisionReport[]> {
  const packages = BUNDLED_SKILLS.map(loadSkillPackage).filter((p): p is SkillPackage => p !== null);
  const reports: ProvisionReport[] = [];

  for (const adapter of CONFIG_ADAPTERS) {
    const displayName = adapter.displayName ?? adapter.providerId;
    // A tool that isn't on this machine gets nothing written for it. An adapter
    // that doesn't implement the check is assumed present.
    if (adapter.isInstalled && !adapter.isInstalled()) continue;

    const report: ProvisionReport = { providerId: adapter.providerId, displayName };

    if (!opts.skipSkills && adapter.installSkill) {
      for (const pkg of packages) {
        const result = adapter.installSkill(pkg);
        // Multiple packages collapse into the most interesting outcome so the
        // startup log stays one line per tool.
        report.skill = mergeResults(report.skill, result);
      }
    }

    if (!opts.skipMcp && adapter.registerMcpServer) {
      report.mcp = await adapter.registerMcpServer({ name: SERVER_NAME, url: opts.mcpUrl });
    }

    if (report.skill || report.mcp) reports.push(report);
  }

  return reports;
}

const SEVERITY: Record<ProvisionResult["status"], number> = {
  failed: 4, installed: 3, updated: 3, skipped: 2, unchanged: 1,
};

function mergeResults(a: ProvisionResult | undefined, b: ProvisionResult): ProvisionResult {
  if (!a) return b;
  return SEVERITY[b.status] > SEVERITY[a.status] ? b : a;
}

/** One log line per outcome; quiet when everything was already in place. */
export function formatProvisionReport(reports: ProvisionReport[]): string[] {
  const lines: string[] = [];
  for (const r of reports) {
    for (const result of [r.skill, r.mcp]) {
      if (!result) continue;
      if (result.status === "unchanged") continue;
      lines.push(`[provision] ${r.displayName}: ${result.detail}`);
      if (result.manualCommand) {
        lines.push(`[provision] ${r.displayName}: run this to finish setup → ${result.manualCommand}`);
      }
    }
  }
  return lines;
}
