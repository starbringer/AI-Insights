import type { Database } from "bun:sqlite";
import type { ToolConfigAdapter } from "../../../config/types";
import { getMcpAudit } from "../../../audit/mcp";
import { getInstructionsReport, readInstructionFile, writeInstructionFile } from "./instructions";
import { listCommands, writeCommandFile, createCommand, deleteCommand } from "./commands";
import { listSkills, writeSkillFile } from "./skills";
import { listHooks, readHookScript, writeHookScript, deleteHook } from "./hooks";
import { getPermissionModel } from "./permissions";
import { listMemoryStores } from "./memory";
import { getEffectiveConfig } from "./effective";
import { listProjectDirs } from "./shared";

/**
 * Claude Code's implementation of the provider-agnostic ToolConfigAdapter.
 * All Claude Code-specific path/layout/frontmatter knowledge lives in the
 * modules of this folder; nothing outside src/providers/claude-code imports
 * them directly.
 */
export const claudeCodeConfigAdapter: ToolConfigAdapter = {
  providerId: "claude-code",

  capabilities: () => ({
    instructions: { editable: true },
    commands: { editable: true },
    skills: { editable: true },
    hooks: { editable: true },
    permissions: { projects: true },
    mcp: {},
    memory: {},
    effectiveConfig: { projects: true },
    dependencies: {},
  }),

  listInstructions: getInstructionsReport,
  readInstructionFile,
  writeInstructionFile,

  listCommands,
  writeCommandFile,
  createCommand,
  deleteCommand,

  listSkills,
  writeSkillFile,

  listHooks,
  readHookScript,
  writeHookScript,
  deleteHook,

  listProjects: listProjectDirs,
  permissionModel: getPermissionModel,

  mcpReport: async (db: Database, forceRefresh = false) => {
    const audit = await getMcpAudit(forceRefresh);
    const agents30d = db.query<{ n: number }, []>(
      `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= date('now','-30 days')`
    ).get()?.n ?? 0;
    return { ...audit, agents30d };
  },

  listMemoryStores,

  effectiveConfig: getEffectiveConfig,
};
