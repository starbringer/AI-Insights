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
// installed on this machine: it copies the bundled skills into each tool's
// user-scope skill directory and registers the local MCP endpoint with it. Both
// steps are idempotent, so this is a no-op from the second run on.
//
// Nothing here knows about Claude Code. It loops the config-adapter registry and
// calls whatever provisioning hooks each adapter implements; a future Codex or
// OpenCode adapter is picked up automatically by implementing them.
// ============================================================================

export interface ProvisionReport {
  providerId: string;
  displayName: string;
  /** One entry per bundled skill, so no install goes unreported. */
  skills?: ProvisionResult[];
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

/**
 * Skills this app ships and keeps installed in every detected tool.
 *
 * Two, deliberately: reviewing usage and measuring a change are different
 * questions with disjoint trigger phrases, and one skill answering both would
 * trigger for neither reliably. They cross-reference each other so a review's
 * recommendation can be verified after it is applied.
 */
export const BUNDLED_SKILLS = ["ai-usage-review", "ai-change-impact"];

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
      // Reported per skill rather than collapsed: a line saying one skill was
      // updated while a second was silently installed is worse than two lines.
      // Unchanged results are dropped at format time, so a settled install stays
      // quiet either way.
      report.skills = packages.map(pkg => adapter.installSkill!(pkg));
    }

    if (!opts.skipMcp && adapter.registerMcpServer) {
      report.mcp = await adapter.registerMcpServer({ name: SERVER_NAME, url: opts.mcpUrl });
    }

    if (report.skills?.length || report.mcp) reports.push(report);
  }

  return reports;
}

/** One log line per outcome; quiet when everything was already in place. */
export function formatProvisionReport(reports: ProvisionReport[]): string[] {
  const lines: string[] = [];
  for (const r of reports) {
    for (const result of [...(r.skills ?? []), r.mcp]) {
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
