import type { Database } from "bun:sqlite";
import type { ToolConfigAdapter } from "../../../config/types";
import { getRetentionDays, retentionCutoffIso } from "../../../retention";
import { getInstructionsReport, readInstructionFile, writeInstructionFile } from "./instructions";
import { listCommands, writeCommandFile, createCommand, deleteCommand } from "./commands";
import { listSkills, writeSkillFile } from "./skills";
import { listHooks, readHookScript, writeHookScript, deleteHook } from "./hooks";
import { getMcpReport, listMcpServerDefs } from "./mcp";
import { getPermissionModel } from "./permissions";
import { listMemoryStores } from "./memory";
import { getEffectiveConfig } from "./effective";
import { listProjectDirs } from "./shared";
import { claudeCodeIsInstalled, installSkill, registerMcpServer } from "./provision";

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
    const report = await getMcpReport(forceRefresh);
    const agents = db.query<{ n: number }, [string]>(
      `SELECT COUNT(DISTINCT agent_id) as n FROM turns WHERE ts >= ?`
    ).get(retentionCutoffIso())?.n ?? 0;
    return { ...report, agents, windowDays: getRetentionDays() };
  },
  mcpServerDefs: listMcpServerDefs,

  listMemoryStores,

  effectiveConfig: getEffectiveConfig,

  displayName: "Claude Code",
  isInstalled: claudeCodeIsInstalled,
  installSkill,
  registerMcpServer,
};
