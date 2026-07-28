import { PROVIDERS } from "../providers";

// ============================================================================
// `?provider=` resolution, shared by the HTTP routes and the MCP tools.
//
// Every read surface in the app is scoped to one data source. The rules are
// the same everywhere so the two entry points can never drift:
//
//   omitted        → the default provider (the first registered one)
//   "<id>"         → that provider, if it is registered
//   "all"          → no filter; aggregate across every registered provider
//   anything else  → an error naming the valid ids
//
// Returning `null` for the filter means "no WHERE clause", which is exactly
// what the aggregate helpers expect.
// ============================================================================

export const ALL_PROVIDERS = "all";

/** Id used when the caller does not name one. Claude Code today. */
export function defaultProviderId(): string | null {
  return PROVIDERS[0]?.id ?? null;
}

export type ProviderResolution =
  | { ok: true; filter: string | null; id: string }
  | { ok: false; error: string };

export function resolveProvider(raw: string | undefined | null): ProviderResolution {
  const value = (raw ?? "").trim();

  if (!value) {
    const id = defaultProviderId();
    // No providers registered at all: fall back to an unfiltered read rather
    // than failing every request.
    return id ? { ok: true, filter: id, id } : { ok: true, filter: null, id: ALL_PROVIDERS };
  }

  if (value === ALL_PROVIDERS) return { ok: true, filter: null, id: ALL_PROVIDERS };

  if (PROVIDERS.some(p => p.id === value)) return { ok: true, filter: value, id: value };

  const known = [...PROVIDERS.map(p => p.id), ALL_PROVIDERS].join(", ");
  return { ok: false, error: `unknown provider "${value}" — known providers: ${known}` };
}
