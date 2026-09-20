import { readFileSync, statSync } from "node:fs";

import { displayPath, resolvePath, writeAtomic, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface EditLimits {
  max_read_bytes: number;
  max_write_bytes: number;
}

export interface EditResult {
  path: string;
  replaced: number;
  bytes: number;
}

export function editFile(args: Record<string, unknown>, space: Workspace, limits: EditLimits): EditResult {
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
  if (stats.size > limits.max_read_bytes) {
    throw new CallError(-32602, `${shown} is ${stats.size} bytes, over the ${limits.max_read_bytes} byte cap`);
  }

  const before = readFileSync(target, "utf8");
  const count = before.split(oldText).length - 1;
  if (count === 0) throw new CallError(-32602, `old_string was not found in ${shown}`);
  if (count > 1 && !all) {
    throw new CallError(-32602, `old_string appears ${count} times in ${shown}; pass replace_all or include more context`);
  }

  const after = all ? before.split(oldText).join(newText) : before.replace(oldText, newText);
  const bytes = Buffer.byteLength(after, "utf8");
  if (bytes > limits.max_write_bytes) {
    throw new CallError(-32602, `the result is ${bytes} bytes, over the ${limits.max_write_bytes} byte cap`);
  }
  writeAtomic(target, after);
  return { path: shown, replaced: all ? count : 1, bytes };
}