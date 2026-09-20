import { closeSync, openSync, readSync, statSync } from "node:fs";

import { displayPath, resolvePath, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface ReadLimits {
  max_read_bytes: number;
}

const DEFAULT_LINES = 2000;

function givenInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CallError(-32602, `${name} must be an integer of at least 1`);
  }
  return value;
}

export function readFile(args: Record<string, unknown>, space: Workspace, limits: ReadLimits): string {
  const target = resolvePath({ path: args.file_path, roots: space.read_roots });
  const shown = displayPath(space.root, target);
  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined) throw new CallError(-32602, `no such file: ${shown}`);
  if (stats.isDirectory()) throw new CallError(-32602, `${shown} is a directory; use glob to list it`);
  if (!stats.isFile()) throw new CallError(-32602, `${shown} is not a regular file`);

  const cap = Math.min(stats.size, limits.max_read_bytes);
  const buffer = Buffer.alloc(cap);
  const descriptor = openSync(target, "r");
  let read = 0;
  try {
    read = readSync(descriptor, buffer, 0, cap, 0);
  } finally {
    closeSync(descriptor);
  }

  const lines = buffer.subarray(0, read).toString("utf8").split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const offset = givenInteger(args.offset, "offset") ?? 1;
  const limit = givenInteger(args.limit, "limit") ?? DEFAULT_LINES;
  if (offset > lines.length) {
    throw new CallError(-32602, `offset ${offset} is past the ${lines.length} lines of ${shown}`);
  }

  const start = offset - 1;
  const slice = lines.slice(start, start + limit);
  const width = String(start + slice.length).length;
  const body = slice.map((line, index) => `${String(start + index + 1).padStart(width)}| ${line}`).join("\n");

  const notes: string[] = [];
  if (read < stats.size) {
    notes.push(`the file is ${stats.size} bytes and the read stopped at the ${limits.max_read_bytes} byte cap`);
  }
  const last = start + slice.length;
  if (last < lines.length) notes.push(`showed lines ${offset}-${last} of ${lines.length}; continue with offset=${last + 1}`);
  return notes.length === 0 ? body : `${body}\n\n(${notes.join("; ")})`;
}