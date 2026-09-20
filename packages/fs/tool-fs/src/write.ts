import { statSync } from "node:fs";

import { displayPath, resolvePath, writeAtomic, type Workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

export interface WriteLimits {
  max_write_bytes: number;
}

export interface WriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

export function writeFile(args: Record<string, unknown>, space: Workspace, limits: WriteLimits): WriteResult {
  const target = resolvePath({ path: args.file_path, roots: [space.root], write: true });
  const shown = displayPath(space.root, target);
  const content = args.content;
  if (typeof content !== "string") throw new CallError(-32602, "content must be a string");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.max_write_bytes) {
    throw new CallError(-32602, `content is ${bytes} bytes, over the ${limits.max_write_bytes} byte cap`);
  }
  const existing = statSync(target, { throwIfNoEntry: false });
  if (existing?.isDirectory() === true) throw new CallError(-32602, `${shown} is a directory`);
  writeAtomic(target, content);
  return { path: shown, bytes, created: existing === undefined };
}