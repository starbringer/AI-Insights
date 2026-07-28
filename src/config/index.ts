import { claudeCodeConfigAdapter } from "../providers/claude-code/config";
import type { ToolConfigAdapter } from "./types";

export type * from "./types";

/**
 * Registry of config adapters, parallel to the transcript provider registry.
 * Adding a new AI tool = implementing ToolConfigAdapter for it and appending
 * it here; the API routes and UI pick it up automatically.
 */
export const CONFIG_ADAPTERS: ToolConfigAdapter[] = [
  claudeCodeConfigAdapter,
];

/**
 * Adapter for a provider id. Configuration is inherently per-tool, so the
 * cross-provider `all` selector that the usage APIs accept collapses to the
 * default adapter here rather than erroring.
 */
export function configAdapterFor(providerId: string | undefined): ToolConfigAdapter | null {
  if (!providerId || providerId === "all") return CONFIG_ADAPTERS[0] ?? null;
  return CONFIG_ADAPTERS.find(a => a.providerId === providerId) ?? null;
}
