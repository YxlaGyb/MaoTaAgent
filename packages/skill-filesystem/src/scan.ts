// 目录结构就是约定: <dir>/<name>/SKILL.md，只扫一层。
// 名字重复时先扫到的赢 —— 顺序就是 dirs 的顺序，写配置的人能预料。
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
      continue; // 目录不存在不是错误: 配置里可能列了一堆可选目录
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