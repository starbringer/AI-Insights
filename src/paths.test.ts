import { test, expect } from "bun:test";
import { classifyTranscriptPath, pathKey, APP_DIR, DATA_DIR, STATIC_DIR } from "./paths";
import { isAbsolute } from "node:path";

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

// pathKey decides whether two spellings of a path are "the same directory".
// Windows filesystems are case-insensitive, so folding there collapses real
// duplicates; folding elsewhere would merge directories that genuinely differ.

test("pathKey collapses case only on Windows", () => {
  const a = pathKey("C:\\Users\\Me\\Proj");
  const b = pathKey("c:\\users\\me\\proj");
  if (process.platform === "win32") expect(a).toBe(b);
  else expect(a).not.toBe(b);
});

test("pathKey is idempotent", () => {
  const p = "/home/me/Proj";
  expect(pathKey(pathKey(p))).toBe(pathKey(p));
});

// APP_DIR anchors data/ and static/. Running from source it is the repo root;
// inside a compiled binary it falls back to the executable's directory. Either
// way it must be a real absolute path — resolving to the filesystem root meant
// the first mkdir of data/ died with EPERM/EACCES.

test("APP_DIR resolves to a real absolute directory, never the filesystem root", () => {
  expect(isAbsolute(APP_DIR)).toBe(true);
  expect(APP_DIR.replace(/[\\/]+$/, "")).not.toBe("");
  expect(APP_DIR).not.toMatch(/^[\\/]$/);
  expect(APP_DIR).not.toMatch(/^[A-Za-z]:[\\/]?$/);
});

test("DATA_DIR and STATIC_DIR sit under APP_DIR", () => {
  expect(DATA_DIR.startsWith(APP_DIR)).toBe(true);
  expect(STATIC_DIR.startsWith(APP_DIR)).toBe(true);
});
