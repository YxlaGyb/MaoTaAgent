import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { maotaHome } from "./store.ts";
import type { RunRecord } from "./types.ts";

const KEEP = 200;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function dirOf(root: string, id: string): string {
  return join(root, "schedule-runs", safe(id));
}

export function writeRun(record: RunRecord, root = maotaHome()): void {
  const dir = dirOf(root, record.schedule_id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = safe(record.occurrence);
  writeFileSync(join(dir, `${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  prune(dir);
}

export function readRuns(id: string, limit = 200, root = maotaHome()): RunRecord[] {
  const dir = dirOf(root, id);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as RunRecord)
      .sort((left, right) => right.started_at.localeCompare(left.started_at))
      .slice(0, Math.max(1, Math.min(200, limit)));
  } catch {
    return [];
  }
}

function prune(dir: string): void {
  const now = Date.now();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => right.at - left.at);
  for (const [index, file] of files.entries()) {
    if (index >= KEEP || now - file.at > MAX_AGE) rmSync(file.path, { force: true });
  }
}