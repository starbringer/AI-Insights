import { test, expect } from "bun:test";
import { ALL_PROVIDERS, defaultProviderId, resolveProvider } from "./providerParam";

// One resolver backs both the HTTP `?provider=` param and the MCP tools'
// `provider` argument, so these rules are the whole contract for "which data
// source am I looking at".

test("an omitted provider resolves to the default source", () => {
  const res = resolveProvider(undefined);
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.id).toBe(defaultProviderId() ?? ALL_PROVIDERS);
  expect(res.filter).toBe("claude-code");
});

test("an empty or whitespace value is treated as omitted", () => {
  for (const raw of ["", "   "]) {
    const res = resolveProvider(raw);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.filter).toBe("claude-code");
  }
});

test("a registered id resolves to a filter on that id", () => {
  const res = resolveProvider("claude-code");
  expect(res).toEqual({ ok: true, filter: "claude-code", id: "claude-code" });
});

test('"all" clears the filter so every source is aggregated', () => {
  expect(resolveProvider("all")).toEqual({ ok: true, filter: null, id: "all" });
});

test("an unknown id fails with a message listing the valid ids", () => {
  const res = resolveProvider("gemini-cli");
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.error).toContain("gemini-cli");
  expect(res.error).toContain("claude-code");
  expect(res.error).toContain("all");
});

test("provider ids are matched exactly, not case-folded or trimmed into", () => {
  expect(resolveProvider("Claude-Code").ok).toBe(false);
  expect(resolveProvider("claude").ok).toBe(false);
});
