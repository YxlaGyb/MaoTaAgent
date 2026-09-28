import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ScheduleRecord } from "./types.ts";

export function maotaHome(): string {
  const configured = process.env.MAOTA_HOME;
  return configured !== undefined && configured.trim() !== "" ? configured : join(homedir(), ".maota");
}

export function stateFile(root = maotaHome()): string {
  return join(root, "schedules.json");
}

export function loadSchedules(root = maotaHome()): ScheduleRecord[] {
  const path = stateFile(root);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as { schedules?: unknown };
  if (!Array.isArray(raw.schedules)) return [];
  return raw.schedules.filter((item): item is ScheduleRecord => item !== null && typeof item === "object" && !Array.isArray(item)) as ScheduleRecord[];
}

export function saveSchedules(records: ScheduleRecord[], root = maotaHome()): void {
  const path = stateFile(root);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ schema_version: 1, schedules: records }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}