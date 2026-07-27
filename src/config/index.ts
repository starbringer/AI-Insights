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

export function configAdapterFor(providerId: string | undefined): ToolConfigAdapter | null {
  if (!providerId) return CONFIG_ADAPTERS[0] ?? null;
  return CONFIG_ADAPTERS.find(a => a.providerId === providerId) ?? null;
}
