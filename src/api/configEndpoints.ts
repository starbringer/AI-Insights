import { Hono } from "hono";
import { getDb } from "../db";
import { CONFIG_ADAPTERS, configAdapterFor } from "../config";
import { buildDependencyGraph } from "../config/graph";
import { captureAll } from "../config/snapshots";
import type { ToolConfigAdapter } from "../config/types";

// ============================================================================
// /api/config/* — provider-agnostic configuration endpoints.
//
// Every route resolves the ToolConfigAdapter for ?provider=<id> (defaulting
// to the first registered adapter) and answers 501 when that adapter doesn't
// implement the capability, so the UI can hide unsupported tabs per provider.
// Writes are validated inside the adapters against the file sets they
// themselves enumerated — no arbitrary-path writes through this API.
// ============================================================================

export const configRouter = new Hono();

function adapterOr501(c: { req: { query: (k: string) => string | undefined } }):
  ToolConfigAdapter | null {
  return configAdapterFor(c.req.query("provider"));
}

// `?provider=` naming a provider with no config adapter is a caller mistake, not
// a missing capability — surface it as 400 with the ids that do work.
configRouter.use("*", async (c, next) => {
  const requested = c.req.query("provider");
  if (requested && requested !== "all" && !CONFIG_ADAPTERS.some(a => a.providerId === requested)) {
    return c.json({
      error: `unknown provider "${requested}" — providers with a config adapter: ${CONFIG_ADAPTERS.map(a => a.providerId).join(", ")}`,
    }, 400);
  }
  await next();

  // Any successful write changed the harness, so fingerprint it now rather than
  // waiting up to 15 minutes for the periodic capture — that keeps the change
  // timeline dated to the edit itself. Applied here so it covers every write
  // route, present and future. A failed snapshot must never fail the write.
  if (c.req.method !== "GET" && c.res.status < 400) {
    const providerId = adapterOr501(c)?.providerId;
    if (providerId) {
      try { captureAll(getDb(), providerId); }
      catch (e) { console.error("[harness] post-write snapshot failed:", e); }
    }
  }
});

const notSupported = { error: "not supported by this provider" } as const;

configRouter.get("/capabilities", c => {
  const a = adapterOr501(c);
  if (!a) return c.json({}, 404);
  return c.json({ providerId: a.providerId, ...a.capabilities() });
});

// ---- Instructions (CLAUDE.md etc.) ----

configRouter.get("/instructions", c => {
  const a = adapterOr501(c);
  if (!a?.listInstructions) return c.json(notSupported, 501);
  return c.json(a.listInstructions(getDb()));
});

configRouter.get("/instructions/file", c => {
  const a = adapterOr501(c);
  if (!a?.readInstructionFile) return c.json(notSupported, 501);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path required" }, 400);
  try {
    const file = a.readInstructionFile(getDb(), path);
    return file ? c.json(file) : c.json({ error: "not found" }, 404);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

configRouter.put("/instructions/file", async c => {
  const a = adapterOr501(c);
  if (!a?.writeInstructionFile) return c.json(notSupported, 501);
  const body = await c.req.json<{ path?: string; content?: string }>();
  if (!body.path || typeof body.content !== "string") {
    return c.json({ error: "path and content required" }, 400);
  }
  try {
    a.writeInstructionFile(getDb(), body.path, body.content);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- Commands ----

configRouter.get("/commands", c => {
  const a = adapterOr501(c);
  if (!a?.listCommands) return c.json(notSupported, 501);
  return c.json(a.listCommands(getDb()));
});

configRouter.put("/commands/file", async c => {
  const a = adapterOr501(c);
  if (!a?.writeCommandFile) return c.json(notSupported, 501);
  const body = await c.req.json<{ path?: string; content?: string }>();
  if (!body.path || typeof body.content !== "string") {
    return c.json({ error: "path and content required" }, 400);
  }
  try {
    a.writeCommandFile(getDb(), body.path, body.content);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

configRouter.post("/commands", async c => {
  const a = adapterOr501(c);
  if (!a?.createCommand) return c.json(notSupported, 501);
  const body = await c.req.json<{ location?: "user" | "project"; projectDir?: string; name?: string; content?: string }>();
  if (!body.name || typeof body.content !== "string" || (body.location !== "user" && body.location !== "project")) {
    return c.json({ error: "location, name and content required" }, 400);
  }
  try {
    return c.json(a.createCommand(getDb(), {
      location: body.location, projectDir: body.projectDir, name: body.name, content: body.content,
    }));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

configRouter.delete("/commands", async c => {
  const a = adapterOr501(c);
  if (!a?.deleteCommand) return c.json(notSupported, 501);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path required" }, 400);
  try {
    a.deleteCommand(getDb(), path);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- Skills ----

configRouter.get("/skills", c => {
  const a = adapterOr501(c);
  if (!a?.listSkills) return c.json(notSupported, 501);
  return c.json(a.listSkills(getDb()));
});

configRouter.put("/skills/file", async c => {
  const a = adapterOr501(c);
  if (!a?.writeSkillFile) return c.json(notSupported, 501);
  const body = await c.req.json<{ path?: string; content?: string }>();
  if (!body.path || typeof body.content !== "string") {
    return c.json({ error: "path and content required" }, 400);
  }
  try {
    a.writeSkillFile(getDb(), body.path, body.content);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- Hooks ----

configRouter.get("/hooks", c => {
  const a = adapterOr501(c);
  if (!a?.listHooks) return c.json(notSupported, 501);
  return c.json(a.listHooks(getDb()));
});

configRouter.get("/hooks/script", c => {
  const a = adapterOr501(c);
  if (!a?.readHookScript) return c.json(notSupported, 501);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path required" }, 400);
  try {
    return c.json(a.readHookScript(getDb(), path));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

configRouter.put("/hooks/script", async c => {
  const a = adapterOr501(c);
  if (!a?.writeHookScript) return c.json(notSupported, 501);
  const body = await c.req.json<{ path?: string; content?: string }>();
  if (!body.path || typeof body.content !== "string") {
    return c.json({ error: "path and content required" }, 400);
  }
  try {
    a.writeHookScript(getDb(), body.path, body.content);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

configRouter.delete("/hooks", async c => {
  const a = adapterOr501(c);
  if (!a?.deleteHook) return c.json(notSupported, 501);
  const sourcePath = c.req.query("sourcePath");
  const event = c.req.query("event");
  const matcherIndex = parseInt(c.req.query("matcherIndex") ?? "", 10);
  if (!sourcePath || !event || isNaN(matcherIndex)) {
    return c.json({ error: "sourcePath, event and matcherIndex required" }, 400);
  }
  try {
    a.deleteHook(getDb(), { sourcePath, event, matcherIndex });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- Permissions ----

configRouter.get("/projects", c => {
  const a = adapterOr501(c);
  if (!a?.listProjects) return c.json(notSupported, 501);
  return c.json(a.listProjects(getDb()));
});

configRouter.get("/permissions", c => {
  const a = adapterOr501(c);
  if (!a?.permissionModel) return c.json(notSupported, 501);
  try {
    return c.json(a.permissionModel(getDb(), c.req.query("project") || undefined));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- MCP ----

configRouter.get("/mcp", async c => {
  const a = adapterOr501(c);
  if (!a?.mcpReport) return c.json(notSupported, 501);
  return c.json(await a.mcpReport(getDb(), c.req.query("refresh") === "1"));
});

// ---- Memory ----

configRouter.get("/memory", c => {
  const a = adapterOr501(c);
  if (!a?.listMemoryStores) return c.json(notSupported, 501);
  return c.json(a.listMemoryStores(getDb()));
});

// ---- Effective configuration ----

configRouter.get("/effective", c => {
  const a = adapterOr501(c);
  if (!a?.effectiveConfig) return c.json(notSupported, 501);
  try {
    return c.json(a.effectiveConfig(getDb(), c.req.query("project") || undefined));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---- Dependency graph (built from the adapter's own neutral outputs) ----

configRouter.get("/dependencies", async c => {
  const a = adapterOr501(c);
  if (!a) return c.json(notSupported, 501);
  const db = getDb();
  const skills = a.listSkills?.(db) ?? [];
  const commands = a.listCommands?.(db) ?? [];
  const hooks = a.listHooks?.(db).entries ?? [];
  const mcpServers = a.mcpReport ? (await a.mcpReport(db)).servers : [];
  return c.json(buildDependencyGraph({
    skills: skills.filter(s => !s.overriddenBy),
    commands: commands.filter(x => !x.overriddenBy),
    hooks,
    mcpServers: mcpServers.map(s => ({ name: s.name })),
  }));
});
