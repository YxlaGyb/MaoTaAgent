import { readFileSync } from "node:fs";
import { join } from "node:path";

import { matchesPath } from "@maota/plugin-kit";

export const IGNORE_NAME = ".gitignore";

/// One line of a `.gitignore`, kept together with the directory it was written
/// in, because a nested file speaks only for the tree below itself.
export interface IgnoreRule {
  base: string;
  pattern: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
}

/// The subset of the `.gitignore` language a search needs: blank lines and
/// `#` comments are dropped, `!` negates, a trailing `/` is about directories,
/// and a leading `/` anchors the rest at the file's own directory.
export function parseIgnore(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let body = raw.trim();
    if (body === "" || body.startsWith("#")) continue;
    const negated = body.startsWith("!");
    if (negated) body = body.slice(1);
    const dirOnly = body.endsWith("/");
    if (dirOnly) body = body.replace(/\/+$/, "");
    const anchored = body.startsWith("/");
    if (anchored) body = body.replace(/^\/+/, "");
    if (body === "") continue;
    rules.push({ base, pattern: body, negated, dirOnly, anchored });
  }
  return rules;
}

export function readIgnore(dir: string, base: string): IgnoreRule[] {
  let text: string;
  try {
    text = readFileSync(join(dir, IGNORE_NAME), "utf8");
  } catch {
    return [];
  }
  return parseIgnore(text, base);
}

function covers(base: string, path: string): boolean {
  return base === "" || path.startsWith(base + "/");
}

function ruleMatches(rule: IgnoreRule, candidate: string, isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  const whole = rule.anchored || rule.pattern.includes("/");
  const target = whole ? candidate : (candidate.split("/").pop() ?? candidate);
  return matchesPath(rule.pattern, target);
}

/// The last rule that speaks about a path wins, which is what lets a nested `!`
/// bring back a file the root file had ignored. A rule about a directory covers
/// everything under it, so each ancestor is offered to the rule as a directory.
export function ignored(rules: readonly IgnoreRule[], path: string, isDir: boolean): boolean {
  let decision = false;
  for (const rule of rules) {
    if (!covers(rule.base, path)) continue;
    const local = rule.base === "" ? path : path.slice(rule.base.length + 1);
    const candidates: Array<[string, boolean]> = [[local, isDir]];
    let walked = "";
    for (const segment of local.split("/").slice(0, -1)) {
      walked = walked === "" ? segment : `${walked}/${segment}`;
      candidates.push([walked, true]);
    }
    if (candidates.some(([candidate, dir]) => ruleMatches(rule, candidate, dir))) decision = !rule.negated;
  }
  return decision;
}