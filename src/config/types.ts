import type { Database } from "bun:sqlite";
import type { Status } from "../thresholds";

// ============================================================================
// Provider-agnostic configuration-inspection layer.
//
// Every AI tool (Claude Code today; Codex, OpenCode, Cline, … later) exposes
// its harness configuration through a ToolConfigAdapter. The API routes and
// the UI consume ONLY the neutral shapes below — no provider-specific
// knowledge leaks past the adapter. Each capability is optional: an adapter
// that doesn't support a section simply omits it and the UI hides that tab
// (driven by GET /api/config/capabilities).
// ============================================================================

/** Where a config item was defined. Providers map their own layering onto this. */
export type ConfigScope = "user" | "project" | "local" | "plugin" | "managed";

// ---- Instructions (CLAUDE.md / AGENTS.md / system-prompt files) ------------

export interface InstructionFile {
  /** Stable id (the absolute path works) used for read/write round-trips. */
  path: string;
  label: string;
  scope: "global" | "project";
  projectDir?: string;
  exists: boolean;
  editable: boolean;
  tokens: number;
  words: number;
}

export interface InstructionsReport {
  files: InstructionFile[];
  /** Injection cost estimate: global instructions × active agents per day. */
  injection: {
    agentCount30d: number;
    estimatedInjectedTokens30d: number;
    dailySeries: { date: string; injectedTokens: number }[];
  };
}

// ---- Slash commands --------------------------------------------------------

export interface CommandInfo {
  name: string;               // namespaced name, e.g. "smart-commit" or "greet:hello"
  invokeName: string;         // what the user types after "/"
  description: string;
  argumentHint?: string;
  usesArguments?: boolean;
  source: "user" | "project" | "plugin";
  projectDir?: string;
  pluginName?: string;
  marketplace?: string;
  version?: string;
  path: string;
  content: string;
  tokens: number;
  editable: boolean;
  overriddenBy?: string;      // uid of the same-named winner definition
}

// ---- Skills -----------------------------------------------------------------

export interface SkillTrigger {
  keyword: string;
  category: "action" | "topic" | "technology" | "format";
}

export interface SkillDetail {
  name: string;
  description: string;
  source: "user" | "project" | "plugin";
  projectDir?: string;
  pluginName?: string;
  marketplace?: string;
  version?: string;
  path: string;
  content: string;
  tokens: number;
  references: string[];       // files under references/
  scripts: string[];          // files under scripts/
  triggers: SkillTrigger[];
  calls30d: number;           // recorded invocations from the event stream
  estTokens30d: number;       // estimated tokens injected by those calls
  editable: boolean;
  overriddenBy?: string;
}

// ---- Hooks -------------------------------------------------------------------

export interface HookActionInfo {
  type: "command" | "http" | "prompt";
  command?: string;
  url?: string;
  prompt?: string;
  timeout?: number;
  /** Resolved path of the script file the command runs, when one is detected on disk. */
  scriptPath?: string;
}

export interface HookEntryInfo {
  event: string;
  matcher?: string;
  actions: HookActionInfo[];
  level: ConfigScope;
  sourcePath: string;
  projectDir?: string;
  matcherIndex: number;
  fires30d: number;           // recorded fires from the transcript event stream
}

export interface HooksReport {
  entries: HookEntryInfo[];
  totalFires30d: number;
}

// ---- Permissions -------------------------------------------------------------

export interface PermissionParam { key: string; value: string; isGlob: boolean }

export interface PermissionRuleInfo {
  raw: string;
  tool: string;
  params: PermissionParam[];
  effect: "allow" | "deny" | "ask";
  level: ConfigScope;
  overriddenBy?: ConfigScope; // same rule redefined at a higher-priority layer
}

export interface PermissionLayerInfo {
  level: ConfigScope;
  filePath: string;
  exists: boolean;
  allow: PermissionRuleInfo[];
  deny: PermissionRuleInfo[];
  ask: PermissionRuleInfo[];
}

export interface PermissionModelInfo {
  layers: PermissionLayerInfo[];
  effective: PermissionRuleInfo[];
}

// ---- MCP servers ---------------------------------------------------------------

export interface McpToolInfo {
  name: string;
  description: string;
  tokens: number;
  inputSchema: unknown;
}

export interface McpServerInfo {
  name: string;
  scope: "user" | "claude.ai" | "local" | "project" | "unknown";
  type: "stdio" | "http" | "sse";
  command?: string;
  source: string;             // config file (or origin) the definition came from
  project?: string;           // project dir, for local/project scopes
  toolCount: number;
  schemaTokens: number;
  tools: McpToolInfo[];
  probeError?: string;        // why tools could not be listed, when they couldn't
}

export interface McpReport {
  status: Status;
  servers: McpServerInfo[];
  totalTools: number;
  totalSchemaTokens: number;
  diagnostics: string[];      // enumeration/probe failures, never swallowed
}

// ---- Memory -------------------------------------------------------------------

export interface MemoryTopicInfo {
  file: string;
  title?: string;
  content: string;
  sizeBytes: number;
  modifiedAt: string;
  referenced: boolean;        // linked from the index file
}

export interface MemoryStoreInfo {
  projectKey: string;         // provider's directory key for the project
  cwd: string | null;         // real project path when resolvable
  dir: string;
  index: { title: string; file: string; summary?: string }[];
  topics: MemoryTopicInfo[];
  lastModifiedAt: string;
}

// ---- Effective configuration (merged settings layers) --------------------------

export interface ConfigLayerInfo {
  level: ConfigScope;
  filePath: string;
  exists: boolean;
  parseError?: string;
  raw: Record<string, unknown>;
}

export interface EffectiveConfigEntry {
  key: string;                // dotted path, e.g. "permissions.allow"
  value: unknown;
  source: ConfigScope;
  overriddenLevels?: ConfigScope[]; // defined at lower-priority layers too
  mergedLevels?: ConfigScope[];     // accumulated, not overridden: every layer listed still applies
  ignoredLevels?: ConfigScope[];    // defined at layers the tool never reads
  sourceIgnored?: boolean;          // every definition sits in an ignored layer
}

export interface EffectiveConfigModel {
  layers: ConfigLayerInfo[];
  effective: EffectiveConfigEntry[];
}

// ---- Dependency graph (built provider-agnostically from the shapes above) -----

export interface DependencyNode {
  id: string;
  type: "skill" | "hook" | "mcp" | "command";
  name: string;
  detail?: string;
}

export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  label: string;              // uses / initializes / configures / invokes / triggers
  via: "content" | "name";    // content reference (strong) vs name-keyword match (weak)
}

export interface DependencyChainStep {
  type: DependencyNode["type"];
  name: string;
  description: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  chains: { key: string; steps: DependencyChainStep[] }[];
  stats: { skills: number; hooks: number; mcpServers: number; commands: number; relationships: number };
}

// ---- Provisioning (installing this app's own assets into the tool) -------------

/** One file of a skill package, at a path relative to the skill's directory. */
export interface SkillPackageFile {
  relPath: string;            // e.g. "SKILL.md" or "references/playbook.md"
  content: string;
}

/** A skill this app ships and wants installed into every detected tool. */
export interface SkillPackage {
  name: string;               // directory name, e.g. "ai-usage-review"
  files: SkillPackageFile[];
}

export interface McpServerRegistration {
  name: string;
  url: string;                // streamable-HTTP endpoint
}

export type ProvisionStatus =
  | "installed"   // created for the first time
  | "updated"     // existed but differed, and was refreshed
  | "unchanged"   // already correct
  | "skipped"     // nothing to do here, with a reason
  | "failed";     // attempted and failed, with the reason

export interface ProvisionResult {
  status: ProvisionStatus;
  detail: string;
  path?: string;
  /** Copy-pasteable command for the user when automatic setup was skipped. */
  manualCommand?: string;
}

// ---- The adapter interface -----------------------------------------------------

export interface CapabilityFlags {
  instructions?: { editable: boolean };
  commands?: { editable: boolean };
  skills?: { editable: boolean };
  hooks?: { editable: boolean };
  permissions?: { projects: boolean }; // supports per-project layering
  mcp?: Record<string, never>;
  memory?: Record<string, never>;
  effectiveConfig?: { projects: boolean };
  dependencies?: Record<string, never>;
}

/**
 * One adapter per AI tool. All methods are optional except id/capabilities —
 * implement what the tool supports. Methods receive the shared SQLite handle
 * so adapters can enrich config data with recorded usage (fires, calls, the
 * projects the tool has actually touched).
 */
export interface ToolConfigAdapter {
  /** Must match the transcript provider's id (e.g. "claude-code"). */
  providerId: string;
  capabilities(): CapabilityFlags;

  listInstructions?(db: Database): InstructionsReport;
  readInstructionFile?(db: Database, path: string): { path: string; content: string } | null;
  writeInstructionFile?(db: Database, path: string, content: string): void;

  listCommands?(db: Database): CommandInfo[];
  writeCommandFile?(db: Database, path: string, content: string): void;
  createCommand?(db: Database, opts: { location: "user" | "project"; projectDir?: string; name: string; content: string }): { path: string };
  deleteCommand?(db: Database, path: string): void;

  listSkills?(db: Database): SkillDetail[];
  writeSkillFile?(db: Database, path: string, content: string): void;

  listHooks?(db: Database): HooksReport;
  readHookScript?(db: Database, path: string): { path: string; content: string };
  writeHookScript?(db: Database, path: string, content: string): void;
  deleteHook?(db: Database, ref: { sourcePath: string; event: string; matcherIndex: number }): void;

  /** Projects that can carry their own config layers (for selector UIs). */
  listProjects?(db: Database): string[];
  permissionModel?(db: Database, projectDir?: string): PermissionModelInfo;

  mcpReport?(db: Database, forceRefresh?: boolean): Promise<McpReport & { agents30d: number }>;

  listMemoryStores?(db: Database): MemoryStoreInfo[];

  effectiveConfig?(db: Database, projectDir?: string): EffectiveConfigModel;

  // ---- Provisioning ----
  // Optional, and deliberately separate from the read/write config methods:
  // these are how the app installs ITS OWN assets (the usage-review skill, the
  // MCP server registration) into whichever tools are present on the machine.
  // A provider that omits them is simply not provisioned.

  /** Human-readable name used in provisioning logs. Defaults to providerId. */
  displayName?: string;

  /** Is this tool actually installed here? Gates every provisioning step. */
  isInstalled?(): boolean;

  /** Install or refresh a skill in the tool's user-scope skill directory. */
  installSkill?(pkg: SkillPackage): ProvisionResult;

  /** Make an MCP server reachable from this tool. */
  registerMcpServer?(server: McpServerRegistration): Promise<ProvisionResult>;
}
