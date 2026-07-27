import type {
  CommandInfo, SkillDetail, HookEntryInfo,
  DependencyGraph, DependencyNode, DependencyEdge, DependencyChainStep,
} from "./types";

// ============================================================================
// Provider-agnostic dependency graph builder.
//
// Consumes only the neutral config shapes (skills / hooks / commands / MCP
// server names), so it works for any tool adapter. Two detection tiers:
//   1. content references — a component's body literally mentions another
//      component (e.g. a skill instructing `mcp__github__create_issue`, a
//      command invoking a skill by name). Strong signal.
//   2. name-keyword relatedness — shared meaningful name segments (the
//      cc-harness heuristic, e.g. `reminder` skill ↔ `reminder-service` MCP).
//      Weak signal, marked `via: "name"` so the UI can render it dimmer.
// ============================================================================

export interface GraphInputs {
  skills: Pick<SkillDetail, "name" | "description" | "content">[];
  commands: Pick<CommandInfo, "name" | "description" | "content">[];
  hooks: Pick<HookEntryInfo, "event" | "matcher" | "actions">[];
  mcpServers: { name: string }[];
}

const GENERIC_WORDS = new Set([
  "the", "and", "for", "with", "run", "get", "set", "all", "new", "use",
  "service", "server", "skill", "hook", "command", "user", "project",
  "claude", "code", "mcp", "tool", "tools",
]);

function keywords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/-(service|server|skill|hook|command|session-start|session-end)$/g, "")
    .split(/[-_\s:]+/)
    .filter(w => w.length > 2 && !GENERIC_WORDS.has(w));
}

function related(a: string, b: string): boolean {
  const ka = keywords(a), kb = keywords(b);
  return ka.some(x => kb.some(y => x === y || x.includes(y) || y.includes(x)));
}

/** Does `text` reference the component name as a whole word / tool prefix? */
function mentions(text: string, name: string): boolean {
  if (!text || name.length < 3) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(text);
}

function hookLabel(h: Pick<HookEntryInfo, "event" | "matcher">, i: number): string {
  return h.matcher ? `${h.event}(${h.matcher})#${i}` : `${h.event}#${i}`;
}

function hookText(h: Pick<HookEntryInfo, "actions">): string {
  return h.actions.map(a => `${a.command ?? ""} ${a.url ?? ""} ${a.prompt ?? ""}`).join(" ");
}

export function buildDependencyGraph(inputs: GraphInputs): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const nodeId = (type: string, name: string) => `${type}:${name}`;

  for (const s of inputs.skills) {
    nodes.push({ id: nodeId("skill", s.name), type: "skill", name: s.name, detail: s.description });
  }
  inputs.hooks.forEach((h, i) => {
    const name = hookLabel(h, i);
    nodes.push({ id: nodeId("hook", name), type: "hook", name, detail: h.actions[0]?.command ?? h.actions[0]?.url });
  });
  for (const m of inputs.mcpServers) {
    nodes.push({ id: nodeId("mcp", m.name), type: "mcp", name: m.name });
  }
  for (const c of inputs.commands) {
    nodes.push({ id: nodeId("command", c.name), type: "command", name: c.name, detail: c.description });
  }

  const seen = new Set<string>();
  const addEdge = (source: string, target: string, label: string, via: DependencyEdge["via"]) => {
    const id = `${source}->${target}`;
    if (seen.has(id)) return;      // content match wins because it is added first
    seen.add(id);
    edges.push({ id, source, target, label, via });
  };

  // 1. Skills → MCP (skill body calls mcp__<server>__* or names the server)
  for (const s of inputs.skills) {
    for (const m of inputs.mcpServers) {
      if (mentions(s.content, `mcp__${m.name}`) || mentions(s.content, m.name)) {
        addEdge(nodeId("skill", s.name), nodeId("mcp", m.name), "uses", "content");
      } else if (related(s.name, m.name)) {
        addEdge(nodeId("skill", s.name), nodeId("mcp", m.name), "uses", "name");
      }
    }
  }

  // 2. Hooks → MCP
  inputs.hooks.forEach((h, i) => {
    const hid = nodeId("hook", hookLabel(h, i));
    const text = hookText(h);
    for (const m of inputs.mcpServers) {
      if (mentions(text, m.name)) addEdge(hid, nodeId("mcp", m.name), "initializes", "content");
      else if (related(hookLabel(h, i), m.name)) addEdge(hid, nodeId("mcp", m.name), "initializes", "name");
    }
  });

  // 3. Skills ↔ Hooks
  inputs.hooks.forEach((h, i) => {
    const hid = nodeId("hook", hookLabel(h, i));
    const text = hookText(h);
    for (const s of inputs.skills) {
      if (mentions(text, s.name)) addEdge(hid, nodeId("skill", s.name), "configures", "content");
      else if (related(s.name, hookLabel(h, i))) addEdge(nodeId("skill", s.name), hid, "configures", "name");
    }
  });

  // 4. Commands → Skills
  for (const c of inputs.commands) {
    for (const s of inputs.skills) {
      if (mentions(c.content, s.name)) addEdge(nodeId("command", c.name), nodeId("skill", s.name), "invokes", "content");
      else if (related(c.name, s.name)) addEdge(nodeId("command", c.name), nodeId("skill", s.name), "invokes", "name");
    }
  }

  // 5. Commands → MCP
  for (const c of inputs.commands) {
    for (const m of inputs.mcpServers) {
      if (mentions(c.content, `mcp__${m.name}`) || mentions(c.content, m.name)) {
        addEdge(nodeId("command", c.name), nodeId("mcp", m.name), "triggers", "content");
      } else if (related(c.name, m.name)) {
        addEdge(nodeId("command", c.name), nodeId("mcp", m.name), "triggers", "name");
      }
    }
  }

  return {
    nodes, edges,
    chains: buildChains(nodes, edges),
    stats: {
      skills: inputs.skills.length,
      hooks: inputs.hooks.length,
      mcpServers: inputs.mcpServers.length,
      commands: inputs.commands.length,
      relationships: edges.length,
    },
  };
}

/**
 * Fold connected components of the edge set into ordered "workflow chains":
 * ① hook fires → ② MCP server starts → ③ skill activates → ④ command runs.
 * Only components touching ≥ 2 node types become chains (a lone pair of
 * same-type nodes is not a workflow).
 */
function buildChains(nodes: DependencyNode[], edges: DependencyEdge[]): DependencyGraph["chains"] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    parent.set(find(e.source), find(e.target));
  }

  const groups = new Map<string, DependencyNode[]>();
  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }
  for (const n of nodes) {
    if (!connected.has(n.id)) continue;
    const root = find(n.id);
    const g = groups.get(root) ?? [];
    g.push(n);
    groups.set(root, g);
  }

  const ORDER: DependencyNode["type"][] = ["hook", "mcp", "skill", "command"];
  const STEP_DESC: Record<DependencyNode["type"], string> = {
    hook: "Hook fires on its event and runs its actions",
    mcp: "MCP server provides tools to the session",
    skill: "Skill activates on matching prompts and injects its instructions",
    command: "Slash command gives the user a shortcut into this flow",
  };

  const chains: DependencyGraph["chains"] = [];
  for (const group of groups.values()) {
    const types = new Set(group.map(n => n.type));
    if (types.size < 2) continue;
    const steps: DependencyChainStep[] = [];
    for (const t of ORDER) {
      for (const n of group.filter(x => x.type === t)) {
        steps.push({ type: t, name: n.name, description: n.detail || STEP_DESC[t] });
      }
    }
    const key = keywords(group.map(n => n.name).join("-"))[0] ?? group[0]!.name;
    chains.push({ key, steps });
  }
  chains.sort((a, b) => b.steps.length - a.steps.length);
  return chains;
}
