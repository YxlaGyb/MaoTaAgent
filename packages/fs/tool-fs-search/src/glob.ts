import { displayPath, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { patternToRegExp, searchBase, walkFiles, type WalkLimits } from "./walk.ts";

export interface GlobLimits extends WalkLimits {
  max_glob_results: number;
}

export interface GlobResult {
  pattern: string;
  path: string;
  count: number;
  truncated: boolean;
  files: string[];
}

export function globFiles(args: Record<string, unknown>, space: Workspace, limits: GlobLimits): GlobResult {
  const pattern = args.pattern;
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new CallError(-32602, "pattern must be a non-empty string");
  }
  const base = searchBase(args, space);
  const matcher = patternToRegExp(pattern);
  const files: string[] = [];
  let stopped = false;

  const progress = walkFiles(base, limits, (full, relative) => {
    if (!matcher.test(relative)) return;
    files.push(displayPath(space.root, full));
    if (files.length < limits.max_glob_results) return;
    stopped = true;
    return false;
  });

  files.sort();
  return {
    pattern,
    path: displayPath(space.root, base),
    count: files.length,
    truncated: progress.capped || stopped,
    files,
  };
}
