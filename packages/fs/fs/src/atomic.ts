import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function writeAtomic(target: string, content: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(target)}.${randomUUID()}.tmp`);
  writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
  try {
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}