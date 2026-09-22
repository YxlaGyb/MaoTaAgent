import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { SKILL_FILE, parseFrontmatter, projectSkill, type SkillCandidate, type SkillSource } from "./protocol.ts";

/// One directory of entries, as both providers read it: a bundle is
/// `<name>/SKILL.md`, a flat entry is `<name>.md`, and how deep a bundle may
/// sit is the root's business, so a skill that carries references and scripts
/// never turns its own folders into skills.
export interface SkillRoot {
  dir: string;
  rank: number;
  source: SkillSource;
  /// How many directory levels below the root a `SKILL.md` may sit: 1 means
  /// only `<name>/SKILL.md`, 3 means `<a>/<b>/<name>/SKILL.md` also counts.
  maxDepth?: number;
}

export interface ScannedRoot {
  candidates: SkillCandidate[];
  notes: string[];
}

const DEFAULT_DEPTH = 1;

function readCandidate(
  root: SkillRoot,
  fallbackName: string,
  file: string,
  base: string,
  notes: string[],
): SkillCandidate | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    notes.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const parsed = parseFrontmatter(text);
  const projected = projectSkill({
    data: parsed.data,
    unsupported: parsed.unsupported,
    body: parsed.body,
    fallbackName,
    source: root.source,
  });
  if (!projected.ok) {
    notes.push(`${file}: ${projected.problems.join("; ")}`);
    return null;
  }
  for (const warning of projected.warnings) notes.push(`${file}: ${warning}`);
  return {
    ...projected.entry,
    rank: root.rank,
    locator: { path: file },
    resourceBase: { kind: "directory", path: base },
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/// A bundle is named by the directory that holds its `SKILL.md`, whatever
/// nesting it sits at, so a nested skill still has to call itself what its
/// folder is called.
function scanDir(
  root: SkillRoot,
  dir: string,
  depth: number,
  maxDepth: number,
  notes: string[],
  candidates: SkillCandidate[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (isDirectory(path)) {
      const bundled = join(path, SKILL_FILE);
      if (existsSync(bundled)) {
        const found = readCandidate(root, name, bundled, path, notes);
        if (found !== null) candidates.push(found);
        continue;
      }
      if (depth < maxDepth) scanDir(root, path, depth + 1, maxDepth, notes, candidates);
      continue;
    }
    const lower = name.toLowerCase();
    if (!lower.endsWith(".md") || lower === SKILL_FILE.toLowerCase()) continue;
    const found = readCandidate(root, name.slice(0, -3), path, dir, notes);
    if (found !== null) candidates.push(found);
  }
}

export function scanSkillRoot(root: SkillRoot): ScannedRoot {
  const notes: string[] = [];
  const candidates: SkillCandidate[] = [];
  scanDir(root, root.dir, 1, Math.max(1, Math.floor(root.maxDepth ?? DEFAULT_DEPTH)), notes, candidates);
  return { candidates, notes };
}

/// The cheap change signature a caching provider compares: newest modification
/// time plus the count of files that could be entries. It is deliberately
/// coarse, because it only has to decide whether a scan is worth repeating.
export function rootStamp(dir: string, maxDepth: number): string {
  const seen = { count: 0, at: 0 };
  const walk = (path: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const child = join(path, name);
      if (isDirectory(child)) {
        if (existsSync(join(child, SKILL_FILE))) {
          seen.count += 1;
          mark(seen, join(child, SKILL_FILE));
          continue;
        }
        if (depth < maxDepth) walk(child, depth + 1);
        continue;
      }
      if (name.toLowerCase().endsWith(".md")) {
        seen.count += 1;
        mark(seen, child);
      }
    }
  };
  walk(dir, 1);
  return `${seen.count}:${Math.floor(seen.at)}`;
}

function mark(seen: { count: number; at: number }, file: string): void {
  try {
    const at = statSync(file).mtimeMs;
    if (at > seen.at) seen.at = at;
  } catch {
    seen.at = Date.now();
  }
}
