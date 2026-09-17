import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { firstParagraph, parseFrontmatter } from "./frontmatter.ts";

export const SKILL_FILE = "SKILL.md";

export interface SkillFile {
  name: string;
  description: string;
  path: string;
}

export function scanDirs(dirs: readonly string[]): SkillFile[] {
  const found = new Map<string, SkillFile>();
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry, SKILL_FILE);
      let text: string;
      try {
        if (!statSync(path).isFile()) continue;
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const meta = parseFrontmatter(text);
      const name = meta.name ?? entry;
      if (found.has(name)) continue;
      found.set(name, { name, description: meta.description ?? firstParagraph(text), path });
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}