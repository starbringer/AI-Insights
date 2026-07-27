import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { parsePermissionRule } from "./providers/claude-code/config/permissions";
import { markOverrides, parseFrontmatter, sourceUid, type Overridable } from "./providers/claude-code/config/shared";
import { buildDependencyGraph } from "./config/graph";
import { getRunUsage } from "./transcripts/usageReport";

describe("parsePermissionRule", () => {
  test("bare tool", () => {
    expect(parsePermissionRule("WebSearch")).toEqual({ raw: "WebSearch", tool: "WebSearch", params: [] });
  });

  test("whole-value tool keeps ':' inside the value", () => {
    const r = parsePermissionRule("Bash(git push:*)");
    expect(r.tool).toBe("Bash");
    expect(r.params).toEqual([{ key: "", value: "git push:*", isGlob: true }]);
  });

  test("named-param tool splits on the first colon", () => {
    const r = parsePermissionRule("WebFetch(domain:github.com)");
    expect(r.params).toEqual([{ key: "domain", value: "github.com", isGlob: false }]);
  });

  test("garbage falls back to raw as tool", () => {
    expect(parsePermissionRule("???").tool).toBe("???");
  });
});

describe("markOverrides", () => {
  test("user beats project beats plugin; losers point at the winner", () => {
    const items: Overridable[] = [
      { name: "gate", source: "plugin", pluginName: "p", marketplace: "m", version: "1.0.0" },
      { name: "gate", source: "project" },
      { name: "gate", source: "user" },
      { name: "solo", source: "project" },
    ];
    markOverrides(items);
    const winner = items.find(i => i.source === "user")!;
    expect(winner.overriddenBy).toBeUndefined();
    expect(items.find(i => i.source === "project" && i.name === "gate")!.overriddenBy).toBe(sourceUid(winner));
    expect(items.find(i => i.source === "plugin")!.overriddenBy).toBe(sourceUid(winner));
    expect(items.find(i => i.name === "solo")!.overriddenBy).toBeUndefined();
  });

  test("among plugins the higher version wins", () => {
    const items: Overridable[] = [
      { name: "x", source: "plugin", pluginName: "p", marketplace: "m", version: "1.2.0" },
      { name: "x", source: "plugin", pluginName: "p", marketplace: "m", version: "1.10.0" },
    ];
    markOverrides(items);
    expect(items[0]!.overriddenBy).toBeDefined();  // 1.2.0 < 1.10.0 (numeric, not lexical)
    expect(items[1]!.overriddenBy).toBeUndefined();
  });
});

describe("parseFrontmatter", () => {
  test("parses flat keys and returns the body", () => {
    const { meta, body } = parseFrontmatter("---\ndescription: hi there\nargument-hint: <x>\n---\nBody text");
    expect(meta["description"]).toBe("hi there");
    expect(meta["argument-hint"]).toBe("<x>");
    expect(body).toBe("Body text");
  });

  test("tolerates CRLF and missing frontmatter", () => {
    expect(parseFrontmatter("---\r\na: b\r\n---\r\nX").meta["a"]).toBe("b");
    expect(parseFrontmatter("no frontmatter").body).toBe("no frontmatter");
  });

  test("folds YAML block scalars (description: >)", () => {
    const md = "---\nname: x\ndescription: >\n  Deep stock research\n  and thesis writing.\nother: y\n---\nBody";
    const { meta } = parseFrontmatter(md);
    expect(meta["description"]).toBe("Deep stock research and thesis writing.");
    expect(meta["other"]).toBe("y");
    const lit = parseFrontmatter("---\nk: |\n  line1\n  line2\n---\n");
    expect(lit.meta["k"]).toBe("line1\nline2");
  });
});

describe("buildDependencyGraph", () => {
  const inputs = {
    skills: [
      { name: "stock-analyst", description: "stocks", content: "call mcp__stock-calculator__calculate_dcf" },
      { name: "island-planner", description: "", content: "nothing related" },
    ],
    commands: [
      { name: "stock-check", description: "", content: "use the stock-analyst skill" },
    ],
    hooks: [
      { event: "SessionStart", matcher: undefined, actions: [{ type: "command" as const, command: "start stock-calculator warmup" }] },
    ],
    mcpServers: [{ name: "stock-calculator" }],
  };

  test("content references beat name matching and produce edges + chains", () => {
    const g = buildDependencyGraph(inputs);
    const skillToMcp = g.edges.find(e => e.source === "skill:stock-analyst" && e.target === "mcp:stock-calculator");
    expect(skillToMcp?.via).toBe("content");
    const cmdToSkill = g.edges.find(e => e.source === "command:stock-check" && e.target === "skill:stock-analyst");
    expect(cmdToSkill?.via).toBe("content");
    const hookToMcp = g.edges.find(e => e.source.startsWith("hook:") && e.target === "mcp:stock-calculator");
    expect(hookToMcp?.via).toBe("content");
    // island-planner shares no keywords or content references — stays unconnected
    expect(g.edges.some(e => e.source === "skill:island-planner")).toBe(false);
    // one connected component with 4 node types → one chain, ordered hook → mcp → skill → command
    expect(g.chains.length).toBe(1);
    expect(g.chains[0]!.steps.map(s => s.type)).toEqual(["hook", "mcp", "skill", "command"]);
    expect(g.stats.relationships).toBe(g.edges.length);
  });
});

describe("getRunUsage", () => {
  function makeDb(): Database {
    const db = new Database(":memory:");
    db.run(`CREATE TABLE turns (
      run_id TEXT, ts TEXT, model TEXT, is_subagent INTEGER, bucket INTEGER,
      input_tokens INTEGER, cache_create_5m INTEGER, cache_create_1h INTEGER,
      cache_read INTEGER, output_tokens INTEGER)`);
    const ins = db.prepare(`INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?)`);
    // base call, skill call, mcp call, sub-agent call (bucket ignored for sub-agents)
    ins.run("r1", "2026-07-01T00:00:01Z", "claude-fable-5", 0, 0, 100, 0, 0, 0, 50);
    ins.run("r1", "2026-07-01T00:00:02Z", "claude-fable-5", 0, 2, 10, 0, 0, 0, 20);
    ins.run("r1", "2026-07-01T00:00:03Z", "claude-fable-5", 0, 1, 10, 0, 0, 0, 20);
    ins.run("r1", "2026-07-01T00:00:04Z", "claude-haiku-4-5", 1, 2, 5, 0, 0, 0, 5);
    return db;
  }

  test("buckets, totals and series come out of the deduped turns table", () => {
    const r = getRunUsage(makeDb(), "r1")!;
    expect(r.turnCount).toBe(4);
    expect(r.total.input).toBe(125);
    expect(r.total.output).toBe(95);
    expect(r.byBucket.base.tokens).toBe(150);
    expect(r.byBucket.skills.tokens).toBe(30);
    expect(r.byBucket.mcp.tokens).toBe(30);
    expect(r.byBucket.subagents.tokens).toBe(10);  // is_subagent wins over bucket
    expect(r.series.length).toBe(4);
    expect(r.byModel.length).toBe(2);
    // zero cache reads on a non-trivial input side → low-cache-hit advice fires
    expect(r.advice.some(a => a.id === "low-cache-hit")).toBe(true);
  });

  test("unknown run yields null", () => {
    expect(getRunUsage(makeDb(), "nope")).toBeNull();
  });
});
