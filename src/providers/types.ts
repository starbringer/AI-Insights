import type { Database } from "bun:sqlite";

/**
 * A NormalizedTurn is the universal, provider-agnostic shape that the
 * detail UI consumes. Each provider maps its own line types into this.
 *
 * The shape mirrors the legacy claude-code DetailTurn so the UI keeps
 * working unchanged during the provider-abstraction refactor. It will
 * be extended in Phase 2 with attachment / event blocks.
 */
export interface NormalizedTurn {
  kind: "human" | "assistant";
  uuid: string;
  timestamp: string;
  text?: string;
  model?: string;
  attachments?: string[];
  toolCalls?: { id: string; name: string; inputSummary: string }[];
  toolResults?: { toolUseId: string; content: string; isError: boolean }[];
  usage?: { input: number; cacheRead: number; cacheCreate: number; output: number } | null;
}

/**
 * A Provider is a self-contained adapter that knows how to:
 *   1. detect its own data on disk (hasData)
 *   2. enumerate + parse its transcript files (scanAll / ingestFile)
 *   3. emit normalized turns for the detail UI (loadAgentDetail)
 *
 * All provider-specific knowledge (file formats, parent-child detection,
 * line-type semantics) lives inside the provider's module. The universal
 * code (DB, aggregations, UI) does not import from any specific provider.
 */
export interface Provider {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData(): boolean;

  /** Glob patterns relative to dataDir that this provider considers transcript files. */
  watchGlobs(): string[];

  /** Cheap check for the watcher: does this file path belong to this provider? */
  fileMatches(path: string): boolean;

  /** Initial full scan on startup. */
  scanAll(db: Database): void;

  /** Incremental ingest for a single file (watcher callbacks). */
  ingestFile(db: Database, filePath: string): void;

  /** Load the normalized turns for a single agent (the detail page). */
  loadAgentDetail(agentId: string): NormalizedTurn[];

  /**
   * Load the session tree for a single agent — the full DAG of everything the
   * agent did (prompts, API calls, tool chains, MCP calls, hooks, errors,
   * compactions, branches), folded into render-ready root trees.
   * Optional: providers without tree-grade data fall back to the flat detail.
   */
  loadAgentTree?(agentId: string): unknown | null;
}

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  dataDir: string;
  hasData: boolean;
}
