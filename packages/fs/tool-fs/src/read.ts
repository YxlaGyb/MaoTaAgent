import { closeSync, openSync, readSync, statSync } from "node:fs";

import { displayPath, resolvePath, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface ReadLimits {
  max_read_bytes: number;
}

const DEFAULT_LINES = 2000;
const BLOCK = 64 * 1024;

function givenInteger(value: unknown, name: string, least: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    throw new CallError(-32602, `${name} must be an integer of at least ${least}`);
  }
  return value;
}

/// How many line breaks sit before `upto`, read in blocks so a byte offset far
/// into a large file costs a scan rather than a second copy of it in memory.
function breaksBefore(target: string, upto: number): number {
  const descriptor = openSync(target, "r");
  const buffer = Buffer.alloc(Math.min(BLOCK, Math.max(1, upto)));
  let seen = 0;
  let offset = 0;
  try {
    while (offset < upto) {
      const read = readSync(descriptor, buffer, 0, Math.min(buffer.length, upto - offset), offset);
      if (read <= 0) break;
      for (let index = 0; index < read; index += 1) {
        if (buffer[index] === 0x0a) seen += 1;
      }
      offset += read;
    }
  } finally {
    closeSync(descriptor);
  }
  return seen;
}

export function readFile(args: Record<string, unknown>, space: Workspace, limits: ReadLimits): string {
  const target = resolvePath({ path: args.file_path, roots: space.read_roots });
  const shown = displayPath(space.root, target);
  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined) throw new CallError(-32602, `no such file: ${shown}`);
  if (stats.isDirectory()) throw new CallError(-32602, `${shown} is a directory; use glob to list it`);
  if (!stats.isFile()) throw new CallError(-32602, `${shown} is not a regular file`);

  const from = givenInteger(args.from_byte, "from_byte", 0) ?? 0;
  if (from > stats.size) {
    throw new CallError(-32602, `from_byte ${from} is past the ${stats.size} bytes of ${shown}`);
  }
  const cap = Math.min(stats.size - from, limits.max_read_bytes);
  const buffer = Buffer.alloc(cap);
  const descriptor = openSync(target, "r");
  let read = 0;
  try {
    read = readSync(descriptor, buffer, 0, cap, from);
  } finally {
    closeSync(descriptor);
  }

  const lines = buffer.subarray(0, read).toString("utf8").split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const offset = givenInteger(args.offset, "offset", 1) ?? 1;
  const limit = givenInteger(args.limit, "limit", 1) ?? DEFAULT_LINES;
  if (offset > lines.length) {
    throw new CallError(-32602, `offset ${offset} is past the ${lines.length} lines this read reached in ${shown}`);
  }

  const window = from === 0 ? 1 : breaksBefore(target, from) + 1;
  const start = offset - 1;
  const slice = lines.slice(start, start + limit);
  const width = String(window + start + slice.length).length;
  const body = slice
    .map((line, index) => `${String(window + start + index).padStart(width)}| ${line}`)
    .join("\n");

  const notes: string[] = [];
  if (from > 0) notes.push(`this read started at byte ${from}, which is line ${window}`);
  if (from + read < stats.size) {
    notes.push(`the file is ${stats.size} bytes and the read stopped at the ${limits.max_read_bytes} byte cap`);
  }
  const last = start + slice.length;
  const whole = from === 0 && read === stats.size;
  if (last < lines.length) {
    notes.push(
      whole
        ? `showed lines ${start + 1}-${last} of ${lines.length}; continue with offset=${last + 1}`
        : `showed lines ${start + 1}-${last} of the window; continue with offset=${last + 1}`,
    );
  }
  const next = from + read;
  if (next < stats.size) notes.push(`continue from byte ${next} with from_byte=${next}`);
  return notes.length === 0 ? body : `${body}\n\n(${notes.join("; ")})`;
}