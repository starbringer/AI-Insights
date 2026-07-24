import { test, expect } from "bun:test";
import { classifyTranscriptPath } from "./paths";

// classifyTranscriptPath must classify BOTH separator styles without ever
// depending on the host platform — the whole point is that the same code runs
// on Windows and POSIX. "\" is a legal filename character on POSIX, so it must
// never be treated as a separator that turns a normal file into a "subagent".

test("POSIX top-level transcript is not a subagent", () => {
  expect(classifyTranscriptPath("/home/me/.claude/projects/-home-me-proj/abc-123.jsonl"))
    .toEqual({ isSubagent: false, parentAgentId: null });
});

test("POSIX subagent transcript resolves its parent agent id", () => {
  expect(classifyTranscriptPath("/home/me/.claude/projects/proj/abc-123/subagents/agent-def-456.jsonl"))
    .toEqual({ isSubagent: true, parentAgentId: "abc-123" });
});

test("Windows top-level transcript is not a subagent", () => {
  expect(classifyTranscriptPath("C:\\Users\\me\\.claude\\projects\\proj\\abc-123.jsonl"))
    .toEqual({ isSubagent: false, parentAgentId: null });
});

test("Windows subagent transcript resolves its parent agent id", () => {
  expect(classifyTranscriptPath("C:\\Users\\me\\.claude\\projects\\proj\\abc-123\\subagents\\agent-def-456.jsonl"))
    .toEqual({ isSubagent: true, parentAgentId: "abc-123" });
});

test("a POSIX filename containing a backslash is not mistaken for a subagent", () => {
  expect(classifyTranscriptPath("/home/me/weird\\name/session.jsonl"))
    .toEqual({ isSubagent: false, parentAgentId: null });
});

test("nested 'subagents' segments take the deepest one as parent", () => {
  expect(classifyTranscriptPath("/p/subagents/a/parent-9/subagents/agent-x.jsonl"))
    .toEqual({ isSubagent: true, parentAgentId: "parent-9" });
});
