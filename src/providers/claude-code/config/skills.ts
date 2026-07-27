import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { countTokens } from "../../../tokenizer";
import { SKILLS_DIR } from "../../../paths";
import type { SkillDetail, SkillTrigger } from "../../../config/types";
import { listProjectDirs, parseFrontmatter, enabledPluginDirs, markOverrides, pathKey } from "./shared";

const ACTION_WORDS = ["create", "generate", "build", "analyze", "convert", "transform", "export",
  "import", "update", "fix", "debug", "test", "deploy", "review", "plan", "design"];
const FORMAT_WORDS = ["pdf", "excel", "xlsx", "docx", "markdown", "json", "yaml", "csv", "xml",
  "html", "svg", "png", "mermaid"];
const TOPIC_WORDS = ["documentation", "diagram", "database", "api", "cloud", "deployment",
  "testing", "architecture", "visualization", "dashboard", "chart", "security", "workflow"];

/** Lightweight trigger analysis: which keywords in a prompt would activate this skill. */
export function analyzeTriggers(name: string, description: string, content: string): SkillTrigger[] {
  const out: SkillTrigger[] = [];
  const seen = new Set<string>();
  const push = (keyword: string, category: SkillTrigger["category"]) => {
    const k = `${category}:${keyword}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ keyword, category });
  };
  // The description is what actually drives skill selection — weight it plus
  // the name; scanning the full body drowns real triggers in noise.
  const text = `${name} ${description}`.toLowerCase();
  for (const w of ACTION_WORDS) if (text.includes(w)) push(w, "action");
  for (const w of FORMAT_WORDS) if (text.includes(w) || content.toLowerCase().includes(`\`${w}\``)) push(w, "format");
  for (const w of TOPIC_WORDS) if (text.includes(w)) push(w, "topic");
  for (const w of name.toLowerCase().split(/[-_\s]+/)) {
    if (w.length > 2) push(w, "technology");
  }
  return out;
}

interface ScanOpts {
  source: "user" | "project" | "plugin";
  projectDir?: string;
  pluginName?: string;
  marketplace?: string;
  version?: string;
}

function listDirFiles(dir: string): string[] {
  try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); }
  catch { return []; }
}

function scanSkillRoot(root: string, opts: ScanOpts, usage: Map<string, { calls: number; tokens: number }>, out: SkillDetail[]): void {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const mdPath = join(root, ent.name, "SKILL.md");
    if (!existsSync(mdPath)) continue;
    let content: string;
    try { content = readFileSync(mdPath, "utf-8"); } catch { continue; }
    const { meta } = parseFrontmatter(content);
    const name = meta["name"] || ent.name;
    const description = meta["description"] ?? "";
    const use = usage.get(name);
    out.push({
      name, description,
      source: opts.source,
      projectDir: opts.projectDir,
      pluginName: opts.pluginName,
      marketplace: opts.marketplace,
      version: opts.version,
      path: mdPath,
      content,
      tokens: countTokens(content),
      references: listDirFiles(join(root, ent.name, "references")),
      scripts: listDirFiles(join(root, ent.name, "scripts")),
      triggers: analyzeTriggers(name, description, content),
      calls30d: use?.calls ?? 0,
      estTokens30d: use?.tokens ?? 0,
      editable: opts.source !== "plugin",
    });
  }
}

export function listSkills(db: Database): SkillDetail[] {
  // Recorded Skill invocations (last 30 days) from the event stream.
  const usage = new Map<string, { calls: number; tokens: number }>();
  const rows = db.query<{ skill: string; calls: number; tokens: number }, []>(
    `SELECT extra as skill, COUNT(*) as calls, COALESCE(SUM(tokens),0) as tokens
     FROM events WHERE kind='tool' AND detail='Skill' AND extra IS NOT NULL
       AND ts >= date('now','-30 days')
     GROUP BY extra`
  ).all();
  for (const r of rows) usage.set(r.skill, { calls: r.calls, tokens: r.tokens });

  const out: SkillDetail[] = [];
  scanSkillRoot(SKILLS_DIR, { source: "user" }, usage, out);
  for (const dir of listProjectDirs(db)) {
    scanSkillRoot(join(dir, ".claude", "skills"), { source: "project", projectDir: dir }, usage, out);
  }
  for (const { dir, plugin } of enabledPluginDirs("skills")) {
    scanSkillRoot(dir, {
      source: "plugin", pluginName: plugin.pluginName,
      marketplace: plugin.marketplace, version: plugin.version,
    }, usage, out);
  }
  markOverrides(out);
  return out.sort((a, b) => b.calls30d - a.calls30d || a.name.localeCompare(b.name));
}

export function writeSkillFile(db: Database, path: string, content: string): void {
  const hit = listSkills(db).find(s => pathKey(s.path) === pathKey(path));
  if (!hit) throw new Error("path is not one of the enumerated SKILL.md files");
  if (!hit.editable) throw new Error("plugin skills are read-only");
  // The directory exists (we enumerated a file inside it), but be safe:
  if (!existsSync(dirname(path))) throw new Error(`skill directory vanished: ${basename(dirname(path))}`);
  writeFileSync(path, content, "utf-8");
}
