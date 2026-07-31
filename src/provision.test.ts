import { test, expect } from "bun:test";
import { BUNDLED_SKILLS, loadSkillPackage, formatProvisionReport } from "./provision";
import { CONFIG_ADAPTERS } from "./config";

// The bundled skill is a shipped asset: if it stops loading, every install
// silently gets nothing. These tests fail loudly instead.

test("every bundled skill loads from disk", () => {
  for (const name of BUNDLED_SKILLS) {
    const pkg = loadSkillPackage(name);
    expect(pkg).not.toBeNull();
    expect(pkg?.name).toBe(name);
  }
});

test("a bundled skill package contains SKILL.md and its references", () => {
  const paths = loadSkillPackage("ai-usage-review")?.files.map(f => f.relPath) ?? [];
  expect(paths).toContain("SKILL.md");
  expect(paths).toContain("references/playbook.md");
  expect(paths).toContain("references/authoring.md");

  const impact = loadSkillPackage("ai-change-impact")?.files.map(f => f.relPath) ?? [];
  expect(impact).toContain("SKILL.md");
  expect(impact).toContain("references/interpretation.md");
});

test("package paths are portable (forward slashes, relative, no traversal)", () => {
  for (const name of BUNDLED_SKILLS) {
    for (const file of loadSkillPackage(name)?.files ?? []) {
      expect(file.relPath).not.toContain("\\");
      expect(file.relPath.startsWith("/")).toBe(false);
      expect(file.relPath).not.toContain("..");
      expect(file.content.length).toBeGreaterThan(0);
    }
  }
});

test("every bundled SKILL.md declares the frontmatter that drives triggering", () => {
  for (const name of BUNDLED_SKILLS) {
    const raw = loadSkillPackage(name)?.files.find(f => f.relPath === "SKILL.md")?.content ?? "";
    // Normalize line endings: the assets are checked out with CRLF on Windows,
    // and the frontmatter is just as valid either way.
    const skillMd = raw.replace(/\r\n/g, "\n");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain(`name: ${name}`);
    // The description is the only thing a model sees when deciding to load a
    // skill, so an empty or missing one makes the skill unreachable.
    const description = /\ndescription: (.+)/.exec(skillMd)?.[1] ?? "";
    expect(description.length).toBeGreaterThan(80);
  }
});

test("a missing skill package resolves to null rather than throwing", () => {
  expect(loadSkillPackage("no-such-skill-here")).toBeNull();
});

test("every skill install is reported, not just the most interesting one", () => {
  // Collapsing them would log "skill A updated" while silently installing B.
  const lines = formatProvisionReport([{
    providerId: "claude-code", displayName: "Claude Code",
    skills: [
      { status: "updated", detail: 'skill "a" updated' },
      { status: "installed", detail: 'skill "b" installed' },
    ],
  }]);

  expect(lines).toEqual([
    '[provision] Claude Code: skill "a" updated',
    '[provision] Claude Code: skill "b" installed',
  ]);
});

test("a settled install stays silent", () => {
  const lines = formatProvisionReport([{
    providerId: "claude-code", displayName: "Claude Code",
    skills: [
      { status: "unchanged", detail: 'skill "a" unchanged' },
      { status: "unchanged", detail: 'skill "b" unchanged' },
    ],
    mcp: { status: "unchanged", detail: "already registered" },
  }]);

  expect(lines).toEqual([]);
});

test("an adapter that can install skills can also report whether its tool exists", () => {
  // Otherwise provisioning would write into a tool that isn't on this machine.
  for (const adapter of CONFIG_ADAPTERS) {
    if (adapter.installSkill || adapter.registerMcpServer) {
      expect(typeof adapter.isInstalled).toBe("function");
    }
  }
});
