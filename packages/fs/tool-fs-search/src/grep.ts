import { closeSync, openSync, readSync, statSync } from "node:fs";

import { displayPath, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { patternToRegExp, searchBase, walkFiles, type WalkLimits } from "./walk.ts";

export interface GrepLimits extends WalkLimits {
  max_matches: number;
  max_line_chars: number;
  max_file_bytes: number;
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

function compile(pattern: unknown): RegExp {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new CallError(-32602, "pattern must be a non-empty string");
  }
  try {
    return new RegExp(pattern);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CallError(-32602, `pattern is not a usable regular expression: ${detail}`);
  }
}

/// One positive glob, the shape a search scope should be: a comma list reads as
/// one impossible pattern and a negation cannot be expressed in a matcher that
/// only answers yes or no, so both are refused where the model can see why.
function includeMatcher(value: unknown): RegExp | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CallError(-32602, "include must be a single glob pattern");
  if (value.includes(",")) throw new CallError(-32602, "include takes one glob pattern, not a comma list");
  if (value.startsWith("!")) throw new CallError(-32602, "include cannot negate; pass one positive glob pattern");
  return patternToRegExp(value);
}

function textOf(buffer: Buffer): string | null {
  return buffer.includes(0) ? null : buffer.toString("utf8");
}

function readBounded(path: string, limit: number): string | null {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) return null;
  if (stats.size > limit) return null;
  const buffer = Buffer.alloc(Math.max(1, stats.size));
  const descriptor = openSync(path, "r");
  let read = 0;
  try {
    read = readSync(descriptor, buffer, 0, buffer.length, 0);
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
  return textOf(buffer.subarray(0, read));
}

function clip(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  let end = maxChars;
  const code = line.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${line.slice(0, end)}…`;
}

export function grepFiles(args: Record<string, unknown>, space: Workspace, limits: GrepLimits): string {
  const pattern = compile(args.pattern);
  const raw = typeof args.pattern === "string" ? args.pattern : "";
  const include = includeMatcher(args.include);
  const base = searchBase(args, space);
  const matches: GrepMatch[] = [];
  let skipped = 0;
  let stopped = false;
  let more = 0;

  const progress = walkFiles(base, limits, (full, relative) => {
    if (include !== null && !include.test(relative)) return;
    const body = readBounded(full, limits.max_file_bytes);
    if (body === null) {
      skipped += 1;
      return;
    }
    const lines = body.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (!pattern.test(line)) continue;
      if (matches.length >= limits.max_matches) {
        stopped = true;
        more += 1;
        continue;
      }
      matches.push({ file: displayPath(space.root, full), line: index + 1, text: clip(line, limits.max_line_chars) });
    }
  });

  const notes: string[] = [];
  if (stopped) {
    notes.push(`stopped at the max_matches of ${limits.max_matches}, so ${more} more matches are not shown`);
  }
  if (progress.capped) notes.push(`the walk stopped after visiting ${progress.visited} entries`);
  if (skipped > 0) notes.push(`${skipped} files skipped as binary or over the ${limits.max_file_bytes} byte cap`);

  if (matches.length === 0) {
    const head = `no matches for ${JSON.stringify(raw)} below ${displayPath(space.root, base)}`;
    return notes.length === 0 ? head : `${head}\n\n(${notes.join("; ")})`;
  }

  matches.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  const shown: string[] = [];
  let current = "";
  for (const match of matches) {
    if (match.file !== current) {
      current = match.file;
      shown.push(current);
    }
    shown.push(`  Line ${match.line}: ${match.text}`);
  }
  return notes.length === 0 ? shown.join("\n") : `${shown.join("\n")}\n\n(${notes.join("; ")})`;
}
