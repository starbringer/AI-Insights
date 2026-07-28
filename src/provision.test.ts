import { test, expect } from "bun:test";
import { BUNDLED_SKILLS, loadSkillPackage } from "./provision";
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
  const pkg = loadSkillPackage("ai-usage-review");
  const paths = pkg?.files.map(f => f.relPath) ?? [];
  expect(paths).toContain("SKILL.md");
  expect(paths).toContain("references/playbook.md");
  expect(paths).toContain("references/authoring.md");
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

test("SKILL.md declares the frontmatter that drives triggering", () => {
  const skillMd = loadSkillPackage("ai-usage-review")?.files.find(f => f.relPath === "SKILL.md")?.content ?? "";
  expect(skillMd.startsWith("---\n")).toBe(true);
  expect(skillMd).toContain("name: ai-usage-review");
  // The description is the only thing a model sees when deciding to load a
  // skill, so an empty or missing one makes the skill unreachable.
  const description = /\ndescription: (.+)/.exec(skillMd)?.[1] ?? "";
  expect(description.length).toBeGreaterThan(80);
});

test("a missing skill package resolves to null rather than throwing", () => {
  expect(loadSkillPackage("no-such-skill-here")).toBeNull();
});

test("an adapter that can install skills can also report whether its tool exists", () => {
  // Otherwise provisioning would write into a tool that isn't on this machine.
  for (const adapter of CONFIG_ADAPTERS) {
    if (adapter.installSkill || adapter.registerMcpServer) {
      expect(typeof adapter.isInstalled).toBe("function");
    }
  }
});
