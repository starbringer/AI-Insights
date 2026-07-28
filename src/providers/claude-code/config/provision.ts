import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLAUDE_BIN, CLAUDE_DIR, CLAUDE_JSON_PATH, SKILLS_DIR } from "../../../paths";
import type { McpServerRegistration, ProvisionResult, SkillPackage } from "../../../config/types";

// ============================================================================
// Claude Code provisioning — installs THIS app's assets into Claude Code.
//
// Two jobs, both idempotent and both safe to re-run on every startup:
//   1. copy the bundled usage-review skill into ~/.claude/skills/<name>/
//   2. register the local MCP endpoint as a user-scope server
//
// The MCP registration goes through the `claude mcp add` CLI rather than
// editing ~/.claude.json directly. That file also stores per-project session
// state and can be many megabytes; a read-modify-write from this process would
// race a running Claude Code and could clobber it. We only ever READ it, to
// check whether the server is registered already.
// ============================================================================

export function claudeCodeIsInstalled(): boolean {
  return existsSync(CLAUDE_DIR);
}

// ---- Skill installation -----------------------------------------------------

export function installSkill(pkg: SkillPackage): ProvisionResult {
  const dir = join(SKILLS_DIR, pkg.name);
  const existedBefore = existsSync(join(dir, "SKILL.md"));

  try {
    let changed = false;
    for (const file of pkg.files) {
      const target = join(dir, file.relPath);
      // Compare before writing so an unchanged install leaves mtimes alone and
      // the startup log stays quiet on every run after the first.
      if (existsSync(target)) {
        try {
          if (readFileSync(target, "utf-8") === file.content) continue;
        } catch { /* unreadable → rewrite it */ }
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, "utf-8");
      changed = true;
    }

    if (!changed) {
      return { status: "unchanged", detail: `skill "${pkg.name}" is up to date`, path: dir };
    }
    return {
      status: existedBefore ? "updated" : "installed",
      detail: `skill "${pkg.name}" ${existedBefore ? "updated" : "installed"} (${pkg.files.length} file(s))`,
      path: dir,
    };
  } catch (e) {
    return {
      status: "failed",
      detail: `could not write ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      path: dir,
    };
  }
}

// ---- MCP registration -------------------------------------------------------

interface ClaudeJsonShape {
  mcpServers?: Record<string, { type?: string; url?: string }>;
}

/** What ~/.claude.json already says about this server, if anything. */
function existingRegistration(name: string): { url?: string } | null {
  if (!existsSync(CLAUDE_JSON_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CLAUDE_JSON_PATH, "utf-8")) as ClaudeJsonShape;
    const entry = parsed.mcpServers?.[name];
    return entry ? { url: entry.url } : null;
  } catch {
    // A malformed or partially-written config is not a reason to fail; fall
    // through and let `claude mcp add` be the authority.
    return null;
  }
}

function manualCommandFor(server: McpServerRegistration): string {
  return `claude mcp add --scope user --transport http ${server.name} ${server.url}`;
}

export async function registerMcpServer(server: McpServerRegistration): Promise<ProvisionResult> {
  const existing = existingRegistration(server.name);
  if (existing?.url === server.url) {
    return { status: "unchanged", detail: `MCP server "${server.name}" is already registered` };
  }

  // A stale entry pointing at a different port must go first — `claude mcp add`
  // refuses to overwrite an existing name.
  if (existing) await run([CLAUDE_BIN, "mcp", "remove", "--scope", "user", server.name]);

  // `claude` resolves through PATH when no installed binary was found on disk;
  // that lookup can still fail, which is a skip (with instructions), not an error.
  const add = await run([CLAUDE_BIN, "mcp", "add", "--scope", "user", "--transport", "http", server.name, server.url]);

  if (add.spawnError) {
    return {
      status: "skipped",
      detail: `the \`claude\` CLI is not runnable here (${add.spawnError})`,
      manualCommand: manualCommandFor(server),
    };
  }
  if (add.exitCode === 0) {
    return {
      status: existing ? "updated" : "installed",
      detail: `MCP server "${server.name}" registered at ${server.url}`,
    };
  }
  const message = (add.stderr || add.stdout).split("\n")[0] ?? "";
  return {
    status: "failed",
    detail: `\`claude mcp add\` exited ${add.exitCode ?? "on timeout"}${message ? `: ${message}` : ""}`,
    manualCommand: manualCommandFor(server),
  };
}

interface RunResult { exitCode: number | null; stdout: string; stderr: string; spawnError?: string }

/**
 * Run a short CLI command without blocking the event loop — this happens while
 * the dashboard is coming up, so `spawnSync` would stall the first page load.
 */
async function run(cmd: string[], timeoutMs = 20_000): Promise<RunResult> {
  try {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      return { exitCode: proc.exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { exitCode: null, stdout: "", stderr: "", spawnError: e instanceof Error ? e.message : String(e) };
  }
}
