import { test, expect } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";
import { computeEffective } from "./effective";
import { shadowsUserConfig } from "./shared";
import type { ConfigLayerInfo, ConfigScope } from "../../../config/types";

// Layers are passed lowest-priority first, exactly as getEffectiveConfig
// assembles them.
const layer = (level: ConfigScope, raw: Record<string, unknown>): ConfigLayerInfo =>
  ({ level, filePath: `${level}.json`, exists: true, raw });

const entry = (layers: ConfigLayerInfo[], key: string) =>
  computeEffective(layers).find(e => e.key === key);

test("permission rules accumulate across layers instead of overriding", () => {
  const e = entry([
    layer("user", { permissions: { allow: ["Bash(git status)", "WebSearch"] } }),
    layer("project", { permissions: { allow: ["Bash(bun run *)"] } }),
  ], "permissions.allow");

  expect(e?.value).toEqual(["Bash(git status)", "WebSearch", "Bash(bun run *)"]);
  expect(e?.overriddenLevels).toBeUndefined();
  expect(e?.mergedLevels).toEqual(["project", "user"]);
});

test("the permissions object merges its rule lists but overrides other children", () => {
  const e = entry([
    layer("user", { permissions: { allow: ["WebSearch"], deny: ["Read(./.env)"], defaultMode: "default" } }),
    layer("project", { permissions: { allow: ["Bash(cat)"], defaultMode: "acceptEdits" } }),
  ], "permissions");

  expect(e?.value).toEqual({
    allow: ["WebSearch", "Bash(cat)"],
    deny: ["Read(./.env)"],
    defaultMode: "acceptEdits",
  });
});

test("a single layer's rules are reported without a merged-from note", () => {
  const e = entry([layer("user", { permissions: { allow: ["WebSearch"] } })], "permissions.allow");
  expect(e?.value).toEqual(["WebSearch"]);
  expect(e?.mergedLevels).toBeUndefined();
});

test("ordinary keys still take the highest layer and report what they override", () => {
  const e = entry([
    layer("user", { model: "opus" }),
    layer("project", { model: "sonnet" }),
  ], "model");

  expect(e?.value).toBe("sonnet");
  expect(e?.source).toBe("project");
  expect(e?.overriddenLevels).toEqual(["user"]);
  expect(e?.mergedLevels).toBeUndefined();
});

test("keys the tool only reads from the user layer stay flagged when set elsewhere", () => {
  const e = entry([
    layer("user", { autoMode: false }),
    layer("project", { autoMode: true }),
  ], "autoMode");

  expect(e?.value).toBe(false);
  expect(e?.source).toBe("user");
  expect(e?.ignoredLevels).toEqual(["project"]);
});

test("the home directory is recognised as sharing the user config dir", () => {
  expect(shadowsUserConfig(homedir())).toBe(true);
  expect(shadowsUserConfig(join(homedir(), "code", "project"))).toBe(false);
});
