import { closeSync, openSync, readSync, statSync } from "node:fs";

import { displayPath, type Workspace } from "@maota/fs";
import { CallError, patternToRegExp } from "@maota/plugin-kit";

import { searchBase, walkFiles, type WalkLimits } from "./walk.ts";

export interface GrepLimits extends WalkLimits {
  max_matches: number;
  max_line_chars: number;
  max_file_bytes: number;
  multiline?: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepResult {
  pattern: string;
  path: string;
  count: number;
  truncated: boolean;
  incomplete: boolean;
  skipped: number;
  matches: GrepMatch[];
  text: string;
}

interface Hit {
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

/// The scope a search may be narrowed to: one glob, or a list of them, any of
/// which lets a file through. A negation cannot be expressed in a matcher that
/// only answers yes or no, so it is refused where the model can see why.
function includeMatchers(value: unknown): { matchers: RegExp[]; wanted: (relative: string) => boolean; dotfiles: boolean } {
  const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  const matchers: RegExp[] = [];
  let dotfiles = false;
  for (const item of list) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new CallError(-32602, "include must be a glob pattern, or a list of them");
    }
    const pattern = item.trim();
    if (pattern.startsWith("!")) {
      throw new CallError(-32602, "include cannot negate; pass positive glob patterns");
    }
    if (/(^|[/\\])\./.test(pattern)) dotfiles = true;
    matchers.push(patternToRegExp(pattern));
  }
  return {
    matchers,
    wanted: (relative) => matchers.length === 0 || matchers.some((matcher) => matcher.test(relative)),
    dotfiles,
  };
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

/// The offsets one line starts at, so a match's line number costs a binary
/// search instead of a scan of everything before it.
function lineStarts(body: string): number[] {
  const starts = [0];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] as number) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/// One line at a time, which is what a search that names no `multiline` does.
function perLine(pattern: RegExp, body: string): Hit[] {
  const lines = body.split(/\r?\n/);
  const hits: Hit[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (pattern.test(line)) hits.push({ line: index + 1, text: line });
  }
  return hits;
}

/// The whole file at once, so a pattern can cross a line break. Every run of
/// whitespace in what matched, break included, is folded to one space, because
/// a hit has to read as one line in the answer.
function acrossLines(pattern: RegExp, body: string): Hit[] {
  const starts = lineStarts(body);
  const re = new RegExp(pattern.source, "g");
  const hits: Hit[] = [];
  for (;;) {
    const match = re.exec(body);
    if (match === null) break;
    if (match[0] === "") {
      re.lastIndex += 1;
      continue;
    }
    hits.push({
      line: lineAt(starts, match.index),
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return hits;
}

export function grepFiles(args: Record<string, unknown>, space: Workspace, limits: GrepLimits): GrepResult {
  const pattern = compile(args.pattern);
  const raw = typeof args.pattern === "string" ? args.pattern : "";
  const include = includeMatchers(args.include);
  const base = searchBase(args, space);
  const multi = limits.multiline === true;
  const matches: GrepMatch[] = [];
  let unreadable = 0;
  let stopped = false;
  let more = 0;

  const progress = walkFiles(
    base,
    { ...limits, dotfiles: include.dotfiles || limits.dotfiles === true },
    (full, relative) => {
      if (!include.wanted(relative)) return;
      const body = readBounded(full, limits.max_file_bytes);
      if (body === null) {
        unreadable += 1;
        return;
      }
      const shown = displayPath(space.root, full);
      for (const hit of multi ? acrossLines(pattern, body) : perLine(pattern, body)) {
        if (matches.length >= limits.max_matches) {
          stopped = true;
          more += 1;
          continue;
        }
        matches.push({ file: shown, line: hit.line, text: clip(hit.text, limits.max_line_chars) });
      }
    },
  );

  const skipped = progress.skipped + unreadable;
  const notes: string[] = [];
  if (stopped) {
    notes.push(`stopped at the max_matches of ${limits.max_matches}, so ${more} more matches are not shown`);
  }
  if (progress.capped) notes.push(`the walk stopped after visiting ${progress.visited} entries`);
  if (progress.skipped > 0) {
    notes.push(`${progress.skipped} entries left out by the ignore files or the hidden-name policy`);
  }
  if (unreadable > 0) notes.push(`${unreadable} files skipped as binary or over the ${limits.max_file_bytes} byte cap`);

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
  const head =
    matches.length === 0
      ? `no matches for ${JSON.stringify(raw)} below ${displayPath(space.root, base)}`
      : shown.join("\n");
  return {
    pattern: raw,
    path: displayPath(space.root, base),
    count: matches.length,
    truncated: stopped,
    incomplete: progress.capped,
    skipped,
    matches,
    text: notes.length === 0 ? head : `${head}\n\n(${notes.join("; ")})`,
  };
}