import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { displayPath, resolvePath, withFileLock, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface EditLimits {
  max_write_bytes: number;
}

export interface EditResult {
  path: string;
  replaced: number;
  bytes: number;
}

const BLOCK = 64 * 1024;

/// A match counted in the text a block was built from, but only once: the tail
/// of the previous block is carried into this one, so a match that ends inside
/// that tail was already counted and is skipped here.
function occurrences(text: string, oldText: string, after: number): number {
  let found = 0;
  let index = 0;
  for (;;) {
    const at = text.indexOf(oldText, index);
    if (at < 0) break;
    if (at + oldText.length > after) found += 1;
    index = at + oldText.length;
  }
  return found;
}

function countMatches(path: string, oldText: string): number {
  const descriptor = openSync(path, "r");
  const buffer = Buffer.alloc(BLOCK);
  const decoder = new StringDecoder("utf8");
  const keep = oldText.length - 1;
  let tail = "";
  let offset = 0;
  let count = 0;
  try {
    for (;;) {
      const read = readSync(descriptor, buffer, 0, BLOCK, offset);
      if (read <= 0) break;
      offset += read;
      const text = tail + decoder.write(buffer.subarray(0, read));
      count += occurrences(text, oldText, tail.length);
      tail = keep > 0 ? text.slice(-keep) : "";
    }
    count += occurrences(tail + decoder.end(), oldText, tail.length);
  } finally {
    closeSync(descriptor);
  }
  return count;
}

/// The replacement is written block by block into a temporary file and renamed
/// over the original, so a large file is never held in memory twice and a
/// reader sees either the old text or the new one. Only text that can no longer
/// take part in a match is emitted, which is what lets a match straddle a block
/// boundary, and the byte budget is checked as the blocks go out.
function rewrite(
  path: string,
  temp: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
  cap: number,
): { replaced: number; bytes: number } {
  const source = openSync(path, "r");
  const sink = openSync(temp, "wx", 0o600);
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(BLOCK);
  const keep = oldText.length - 1;
  let tail = "";
  let offset = 0;
  let replaced = 0;
  let bytes = 0;
  try {
    for (;;) {
      const read = readSync(source, buffer, 0, BLOCK, offset);
      const last = read <= 0;
      if (!last) offset += read;
      const text = tail + (last ? decoder.end() : decoder.write(buffer.subarray(0, read)));
      const safeEnd = last ? text.length : Math.max(0, text.length - keep);
      let out = "";
      let cursor = 0;
      for (;;) {
        const at = text.indexOf(oldText, cursor);
        if (at < 0 || at >= safeEnd) break;
        if (!replaceAll && replaced >= 1) break;
        out += text.slice(cursor, at) + newText;
        cursor = at + oldText.length;
        replaced += 1;
      }
      const emitTo = Math.max(safeEnd, cursor);
      out += text.slice(cursor, emitTo);
      if (out !== "") {
        const chunk = Buffer.from(out, "utf8");
        bytes += chunk.length;
        if (bytes > cap) {
          throw new CallError(-32602, `the result is ${bytes} bytes, over the ${cap} byte cap`);
        }
        writeSync(sink, chunk);
      }
      tail = text.slice(emitTo);
      if (last) break;
    }
  } catch (error) {
    closeSync(source);
    closeSync(sink);
    rmSync(temp, { force: true });
    throw error;
  }
  closeSync(source);
  closeSync(sink);
  return { replaced, bytes };
}

export function editFile(
  args: Record<string, unknown>,
  space: Workspace,
  limits: EditLimits,
): Promise<EditResult> {
  const target = resolvePath({ path: args.file_path, roots: [space.root], write: true });
  const shown = displayPath(space.root, target);
  const oldText = args.old_string;
  const newText = args.new_string;
  if (typeof oldText !== "string" || oldText === "") {
    throw new CallError(-32602, "old_string must be a non-empty string");
  }
  if (typeof newText !== "string") throw new CallError(-32602, "new_string must be a string");
  const all = args.replace_all === true;

  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats === undefined) throw new CallError(-32602, `no such file: ${shown}`);
  if (!stats.isFile()) throw new CallError(-32602, `${shown} is not a regular file`);

  return withFileLock(target, () => {
    const count = countMatches(target, oldText);
    if (count === 0) throw new CallError(-32602, `old_string was not found in ${shown}`);
    if (count > 1 && !all) {
      throw new CallError(-32602, `old_string appears ${count} times in ${shown}; pass replace_all or include more context`);
    }
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
    const out = rewrite(target, temp, oldText, newText, all, limits.max_write_bytes);
    if (out.replaced === 0) {
      rmSync(temp, { force: true });
      throw new CallError(-32602, `old_string was not found in ${shown}`);
    }
    renameSync(temp, target);
    return { path: shown, replaced: out.replaced, bytes: out.bytes };
  });
}