import { readFileSync } from "node:fs";
import { join } from "path";
import { readdirSync } from "node:fs";
import { PROJECTS_DIR } from "../paths";

export interface ToolCall {
  id: string;
  name: string;
  inputSummary: string;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface UsageInfo {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
}

export interface HumanTurn {
  kind: "human";
  uuid: string;
  timestamp: string;
  text: string;
}

export interface AssistantTurn {
  kind: "assistant";
  uuid: string;
  timestamp: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  usage: UsageInfo | null;
}

export type DetailTurn = HumanTurn | AssistantTurn;

function findSessionFile(sessionId: string): string | null {
  function search(dir: string, depth = 0): string | null {
    if (depth > 4) return null;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          const f = search(join(dir, e.name), depth + 1);
          if (f) return f;
        } else if (e.name === `${sessionId}.jsonl`) {
          return join(dir, e.name);
        }
      }
    } catch { }
    return null;
  }
  return search(PROJECTS_DIR);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 800);
  if (Array.isArray(content)) {
    return content
      .filter((b: unknown) => (b as Record<string, unknown>)["type"] === "text")
      .map((b: unknown) => String((b as Record<string, unknown>)["text"] ?? ""))
      .join("\n")
      .slice(0, 800);
  }
  return "";
}

export function loadSessionDetail(sessionId: string): DetailTurn[] {
  const path = findSessionFile(sessionId);
  if (!path) return [];

  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").filter(Boolean);

  // Pass 1: collect all entries
  interface RawEntry {
    type: string;
    uuid: string;
    timestamp: string;
    isMeta?: boolean;
    message?: Record<string, unknown>;
  }
  const entries: RawEntry[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as RawEntry;
      if (e.type === "user" || e.type === "assistant") entries.push(e);
    } catch { }
  }

  // Pass 2: build tool result map (uuid -> results)
  const toolResultsByParent = new Map<string, ToolResult[]>();
  for (const e of entries) {
    if (e.type !== "user" || !e.message) continue;
    const content = e.message["content"];
    if (!Array.isArray(content)) continue;
    const results = content.filter((b: unknown) => (b as Record<string, unknown>)["type"] === "tool_result");
    if (!results.length) continue;
    // parentUuid links this user entry back to the assistant that fired the tool
    const parentUuid = (e as unknown as Record<string, unknown>)["parentUuid"] as string;
    if (!parentUuid) continue;
    const list: ToolResult[] = results.map((tr: unknown) => {
      const t = tr as Record<string, unknown>;
      const c = t["content"];
      const txt = Array.isArray(c)
        ? c.filter((x: unknown) => (x as Record<string, unknown>)["type"] === "text")
            .map((x: unknown) => String((x as Record<string, unknown>)["text"] ?? ""))
            .join("\n")
        : String(c ?? "");
      return { toolUseId: String(t["tool_use_id"] ?? ""), content: txt.slice(0, 600), isError: t["is_error"] === true };
    });
    toolResultsByParent.set(parentUuid, list);
  }

  // Pass 3: build turns
  const turns: DetailTurn[] = [];
  for (const e of entries) {
    if (!e.message) continue;

    if (e.type === "user") {
      if (e.isMeta) continue;
      const content = e.message["content"];
      if (Array.isArray(content)) {
        const hasOnlyToolResults = content.every((b: unknown) => (b as Record<string, unknown>)["type"] === "tool_result");
        if (hasOnlyToolResults) continue; // handled as part of assistant turn
      }
      const text = contentText(content);
      if (!text.trim()) continue;
      turns.push({ kind: "human", uuid: e.uuid, timestamp: e.timestamp, text });

    } else if (e.type === "assistant") {
      const content = (e.message["content"] as unknown[]) ?? [];
      const textParts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b["type"] === "text") {
          textParts.push(String(b["text"] ?? "").slice(0, 800));
        } else if (b["type"] === "tool_use") {
          const inputStr = JSON.stringify(b["input"] ?? {});
          toolCalls.push({
            id: String(b["id"] ?? ""),
            name: String(b["name"] ?? "unknown"),
            inputSummary: inputStr.slice(0, 300),
          });
        }
        // skip thinking blocks
      }

      const usage = e.message["usage"] as Record<string, unknown> | undefined;
      const toolResults = toolResultsByParent.get(e.uuid) ?? [];

      turns.push({
        kind: "assistant",
        uuid: e.uuid,
        timestamp: e.timestamp,
        model: String(e.message["model"] ?? ""),
        text: textParts.join("\n").slice(0, 800),
        toolCalls,
        toolResults,
        usage: usage ? {
          input: Number(usage["input_tokens"] ?? 0),
          cacheRead: Number(usage["cache_read_input_tokens"] ?? 0),
          cacheCreate: Number(usage["cache_creation_input_tokens"] ?? 0),
          output: Number(usage["output_tokens"] ?? 0),
        } : null,
      });
    }
  }

  return turns;
}
