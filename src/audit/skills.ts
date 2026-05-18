import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR } from "../paths";
import { countTokens } from "../tokenizer";

export interface SkillInfo {
  name: string;
  description: string;
  tokens: number;
}

export interface SkillsAudit {
  count: number;
  skills: SkillInfo[];
}

function extractDescription(md: string): string {
  const lines = md.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) return trimmed.slice(0, 100);
  }
  return "";
}

export function getSkillsAudit(): SkillsAudit {
  if (!existsSync(SKILLS_DIR)) return { count: 0, skills: [] };

  const skills: SkillInfo[] = [];
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const name of dirs) {
      const mdPath = join(SKILLS_DIR, name, "SKILL.md");
      if (existsSync(mdPath)) {
        const md = readFileSync(mdPath, "utf-8");
        skills.push({ name, description: extractDescription(md), tokens: countTokens(md) });
      }
    }
  } catch { /* skip on read errors */ }

  return { count: skills.length, skills };
}
