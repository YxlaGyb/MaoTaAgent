import { appendFileSync, statSync } from "node:fs";

import { displayPath, resolvePath, withFileLock, writeAtomic, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface WriteLimits {
  max_write_bytes: number;
}

export type WriteMode = "replace" | "append";

export interface WriteResult {
  path: string;
  bytes: number;
  created: boolean;
  mode: WriteMode;
}

function modeOf(value: unknown): WriteMode {
  if (value === undefined || value === null) return "replace";
  if (value === "replace" || value === "append") return value;
  throw new CallError(-32602, `mode must be "replace" or "append", got ${JSON.stringify(value)}`);
}

/// A whole file, written under the same lock a second host honours: either the
/// file is replaced or the text is appended, and either way a reader sees the
/// document before the write or after it, never half of one.
export function writeFile(
  args: Record<string, unknown>,
  space: Workspace,
  limits: WriteLimits,
): Promise<WriteResult> {
  const target = resolvePath({ path: args.file_path, roots: [space.root], write: true });
  const shown = displayPath(space.root, target);
  const content = args.content;
  if (typeof content !== "string") throw new CallError(-32602, "content must be a string");
  const mode = modeOf(args.mode);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.max_write_bytes) {
    throw new CallError(-32602, `content is ${bytes} bytes, over the ${limits.max_write_bytes} byte cap`);
  }
  const existing = statSync(target, { throwIfNoEntry: false });
  if (existing?.isDirectory() === true) throw new CallError(-32602, `${shown} is a directory`);
  if (mode === "append" && existing !== undefined && existing.size + bytes > limits.max_write_bytes) {
    throw new CallError(
      -32602,
      `appending ${bytes} bytes to the ${existing.size} bytes of ${shown} would pass the ${limits.max_write_bytes} byte cap`,
    );
  }
  return withFileLock(target, () => {
    if (mode === "append" && existing !== undefined) appendFileSync(target, content, { mode: 0o600 });
    else writeAtomic(target, content);
    return { path: shown, bytes, created: existing === undefined, mode };
  });
}