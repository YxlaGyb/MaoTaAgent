import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

export const COMPACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CompactionTrigger = "pressure" | "overflow" | "manual";
export type CompactionKind = "prune" | "summary";
export type CompactionStatus = "committed" | "failed";

export interface CompactSource {
  kind: "compact";
  id: string;
  folded: number;
  trigger: CompactionTrigger;
}

export interface ArtifactRef {
  name: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface ArchiveRef {
  path: string;
  bytes: number;
  sha256: string;
  messages: number;
}

export interface CompactionRecord {
  id: string;
  at: string;
  trigger: CompactionTrigger;
  kind: CompactionKind;
  status: CompactionStatus;
  folded: number;
  chars_before: number;
  chars_after: number;
  artifacts: ArtifactRef[];
  archive?: ArchiveRef;
  error?: string;
}

function objectOf(value: unknown, label: string, strict: boolean): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (strict) throw new CallError(-32602, `${label} must be an object`);
  return null;
}

function text(value: unknown, label: string, strict: boolean): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (strict) throw new CallError(-32602, `${label} must be a non-empty string`);
  return null;
}

function count(value: unknown, label: string, strict: boolean, minimum = 0): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= minimum) return value;
  if (strict) throw new CallError(-32602, `${label} must be an integer >= ${minimum}`);
  return null;
}

function triggerOf(value: unknown, strict: boolean): CompactionTrigger | null {
  if (value === "pressure" || value === "overflow" || value === "manual") return value;
  if (strict) throw new CallError(-32602, `compaction trigger must be pressure, overflow or manual`);
  return null;
}

function kindOf(value: unknown, strict: boolean): CompactionKind | null {
  if (value === "prune" || value === "summary") return value;
  if (strict) throw new CallError(-32602, `compaction kind must be prune or summary`);
  return null;
}

function statusOf(value: unknown, strict: boolean): CompactionStatus | null {
  if (value === "committed" || value === "failed") return value;
  if (strict) throw new CallError(-32602, `compaction status must be committed or failed`);
  return null;
}

export function compactSourceOf(value: unknown, strict: boolean): CompactSource | null {
  const input = objectOf(value, "compact source", strict);
  if (input === null || input.kind !== "compact") return null;
  const id = text(input.id, "compact source id", strict);
  const folded = count(input.folded, "compact source folded", strict, 1);
  const trigger = triggerOf(input.trigger, strict);
  return id === null || folded === null || trigger === null ? null : { kind: "compact", id, folded, trigger };
}

export function artifactRefOf(value: unknown, strict: boolean): ArtifactRef | null {
  const input = objectOf(value, "artifact ref", strict);
  if (input === null) return null;
  const name = text(input.name, "artifact name", strict);
  const path = text(input.path, "artifact path", strict);
  const bytes = count(input.bytes, "artifact bytes", strict);
  const sha256 = text(input.sha256, "artifact sha256", strict);
  return name === null || path === null || bytes === null || sha256 === null
    ? null
    : { name, path, bytes, sha256 };
}

export function archiveRefOf(value: unknown, strict: boolean): ArchiveRef | null {
  const input = objectOf(value, "archive ref", strict);
  if (input === null) return null;
  const path = text(input.path, "archive path", strict);
  const bytes = count(input.bytes, "archive bytes", strict);
  const sha256 = text(input.sha256, "archive sha256", strict);
  const messages = count(input.messages, "archive messages", strict);
  return path === null || bytes === null || sha256 === null || messages === null
    ? null
    : { path, bytes, sha256, messages };
}

export function compactionRecordOf(value: unknown, strict: boolean): CompactionRecord | null {
  const input = objectOf(value, "compaction record", strict);
  if (input === null) return null;
  const id = text(input.id, "compaction id", strict);
  const at = text(input.at, "compaction time", strict);
  const trigger = triggerOf(input.trigger, strict);
  const kind = kindOf(input.kind, strict);
  const status = statusOf(input.status, strict);
  const folded = count(input.folded, "compaction folded", strict);
  const charsBefore = count(input.chars_before, "compaction chars_before", strict);
  const charsAfter = count(input.chars_after, "compaction chars_after", strict);
  if (id === null || !COMPACTION_ID.test(id)) {
    if (strict) throw new CallError(-32602, `compaction id must match ${COMPACTION_ID.source}`);
    return null;
  }
  if (at === null || trigger === null || kind === null || status === null || folded === null || charsBefore === null || charsAfter === null) {
    return null;
  }
  const artifacts: ArtifactRef[] = [];
  if (!Array.isArray(input.artifacts)) {
    if (strict) throw new CallError(-32602, "compaction artifacts must be an array");
    return null;
  }
  for (const raw of input.artifacts) {
    const artifact = artifactRefOf(raw, strict);
    if (artifact === null) return null;
    artifacts.push(artifact);
  }
  const archive = input.archive === undefined ? undefined : archiveRefOf(input.archive, strict);
  if (input.archive !== undefined && archive === null) return null;
  const error = input.error === undefined ? undefined : text(input.error, "compaction error", strict);
  if (input.error !== undefined && error === null) return null;
  return {
    id,
    at,
    trigger,
    kind,
    status,
    folded,
    chars_before: charsBefore,
    chars_after: charsAfter,
    artifacts,
    ...(archive === undefined || archive === null ? {} : { archive }),
    ...(error === undefined || error === null ? {} : { error }),
  };
}

export function compactionsOf(value: unknown, strict: boolean): CompactionRecord[] | null {
  if (!Array.isArray(value)) {
    if (strict) throw new CallError(-32602, "compactions must be an array");
    return null;
  }
  const out: CompactionRecord[] = [];
  for (const raw of value) {
    const record = compactionRecordOf(raw, strict);
    if (record === null) return null;
    out.push(record);
  }
  return out;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function safeName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  return safe === "" ? "artifact" : safe;
}

function writeExclusive(path: string, text: string): { bytes: number; sha256: string } {
  writeFileSync(path, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { bytes: Buffer.byteLength(text, "utf8"), sha256: digest(text) };
}

export function historyDir(root: string, encodedCwd: string, id: string): string {
  return join(root, encodedCwd, `${id}.history`);
}

export function writeArtifactFile(dir: string, name: string, content: string): ArtifactRef {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safe = safeName(name);
  const path = join(dir, `${safe}.txt`);
  const written = writeExclusive(path, content);
  return { name: safe, path, ...written };
}

export function writeArchiveFile(dir: string, id: string, text: string, messages: number): ArchiveRef {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.jsonl`);
  const written = writeExclusive(path, text);
  return { path, messages, ...written };
}

export function removeHistoryDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
