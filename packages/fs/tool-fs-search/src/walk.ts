import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { displayPath, resolvePath, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { ignored, readIgnore, type IgnoreRule } from "./ignore.ts";

export const VISITED_CAP = 50_000;

export interface WalkLimits {
  follow_links: boolean;
  dotfiles?: boolean;
}

export interface WalkProgress {
  visited: number;
  capped: boolean;
  skipped: number;
}

function classify(entry: Dirent, full: string, followLinks: boolean): "dir" | "file" | null {
  if (entry.isSymbolicLink()) {
    if (!followLinks) return null;
    const stats = statSync(full, { throwIfNoEntry: false });
    if (stats === undefined) return null;
    if (stats.isDirectory()) return "dir";
    return stats.isFile() ? "file" : null;
  }
  if (entry.isDirectory()) return "dir";
  return entry.isFile() ? "file" : null;
}

export function searchBase(args: Record<string, unknown>, space: Workspace): string {
  const requested = args.path;
  if (requested === undefined || requested === null || requested === "") return space.root;
  const target = resolvePath({ path: requested, roots: [space.root] });
  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined) throw new CallError(-32602, `no such directory: ${displayPath(space.root, target)}`);
  if (!stats.isDirectory()) throw new CallError(-32602, `${displayPath(space.root, target)} is not a directory`);
  return target;
}

/// One pass over the tree below `base`, handing every regular file to `visit`
/// with its absolute path and its path relative to `base`. Four things never
/// reach `visit`, and are counted in `skipped` instead: a link the policy does
/// not follow, a hidden name, `.git`, and anything the ignore files rule out —
/// read from the root and from every nested `.gitignore` the walk enters. A
/// `visit` that returns `false` stops the walk, which is how a caller enforces
/// its own result budget; the shared `VISITED_CAP` bounds a tree that never
/// settles.
export function walkFiles(
  base: string,
  limits: WalkLimits,
  visit: (full: string, relative: string) => boolean | void,
): WalkProgress {
  const stack: string[] = [base];
  const rules: IgnoreRule[] = [];
  let visited = 0;
  let capped = false;
  let skipped = 0;

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const label = displayPath(base, dir);
    rules.push(...readIgnore(dir, label === "." ? "" : label));
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > VISITED_CAP) {
        capped = true;
        break;
      }
      const full = join(dir, entry.name);
      const kind = classify(entry, full, limits.follow_links);
      if (kind === null) {
        skipped += 1;
        continue;
      }
      const relative = displayPath(base, full);
      const hidden = limits.dotfiles !== true && entry.name.startsWith(".");
      if (hidden || entry.name === ".git" || ignored(rules, relative, kind === "dir")) {
        skipped += 1;
        continue;
      }
      if (kind === "dir") {
        stack.push(full);
        continue;
      }
      if (visit(full, relative) === false) return { visited, capped, skipped };
    }
    if (capped) break;
  }
  return { visited, capped, skipped };
}