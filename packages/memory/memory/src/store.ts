import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { TextDecoder } from "node:util";

import { maotaHome, projectRoot, withFileLock, writeAtomic } from "@maota/fs";

import {
  DEFAULT_MEMORY_CHARS,
  DEFAULT_USER_CHARS,
  applyOperations,
  entriesText,
  hasDrift,
  parseEntries,
  readOperations,
  renderBlock,
  sanitizeEntry,
  usageOf,
  type MemoryTarget,
} from "./format.ts";

export interface MemoryLimits {
  memory: number;
  user: number;
}

export const DEFAULT_LIMITS: MemoryLimits = {
  memory: DEFAULT_MEMORY_CHARS,
  user: DEFAULT_USER_CHARS,
};

export interface MemoryInfo {
  target: MemoryTarget;
  path: string;
  chars: number;
  limit: number;
  entries: number;
  usage: string;
  error?: string;
}

export interface MemoryInfoView {
  memory: MemoryInfo;
  user: MemoryInfo;
}

export interface MutationSuccess {
  success: true;
  done: true;
  target: MemoryTarget;
  usage: string;
  entry_count: number;
  message: string;
}

export interface MutationFailure {
  success: false;
  target?: MemoryTarget;
  usage?: string;
  error: string;
  current_entries?: string[];
}

export type MutationResult = MutationSuccess | MutationFailure;

interface ReadResult {
  ok: boolean;
  path: string;
  raw: string;
  entries: string[];
  drift: boolean;
  error?: string;
}

function decoder(): TextDecoder {
  return new TextDecoder("utf-8", { fatal: true });
}

function realOrResolved(path: string): string {
  try {
    return projectRoot(path);
  } catch {
    return path;
  }
}

export function projectKey(cwd: string): string {
  const root = realOrResolved(cwd);
  const name = basename(root).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48) || "project";
  const digest = createHash("sha256").update(root.split("\\").join("/")).digest("hex").slice(0, 16);
  return `${name}-${digest}`;
}

export function pathsFor(cwd: string): { user: string; memory: string } {
  const root = join(maotaHome(), "memories");
  return {
    user: join(root, "USER.md"),
    memory: join(root, projectKey(cwd), "MEMORY.md"),
  };
}

function readTarget(path: string): ReadResult {
  if (!existsSync(path)) return { ok: true, path, raw: "", entries: [], drift: false };
  let raw: string;
  try {
    raw = decoder().decode(readFileSync(path));
  } catch (error) {
    return {
      ok: false,
      path,
      raw: "",
      entries: [],
      drift: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const entries = parseEntries(raw);
  return { ok: true, path, raw, entries, drift: raw.trim() !== "" && hasDrift(raw, entries) };
}

function backup(path: string, raw: string): string {
  const target = `${path}.bak.${randomUUID()}`;
  writeAtomic(target, raw);
  return target;
}

function infoOf(target: MemoryTarget, path: string, limit: number): MemoryInfo {
  const read = readTarget(path);
  const chars = read.ok ? entriesText(read.entries).length : 0;
  return {
    target,
    path,
    chars,
    limit,
    entries: read.ok ? read.entries.length : 0,
    usage: `${chars}/${limit}`,
    ...(read.error === undefined && !read.drift
      ? {}
      : { error: read.error ?? "the memory file does not round-trip through the memory tool" }),
  };
}

export function infoFor(cwd: string, limits: MemoryLimits = DEFAULT_LIMITS): MemoryInfoView {
  const paths = pathsFor(cwd);
  return {
    user: infoOf("user", paths.user, limits.user),
    memory: infoOf("memory", paths.memory, limits.memory),
  };
}

export function loadMemoryBlocks(
  cwd: string,
  limits: MemoryLimits = DEFAULT_LIMITS,
): { blocks: Array<{ target: MemoryTarget; path: string; text: string; entries: string[] }> } {
  const paths = pathsFor(cwd);
  const out: Array<{ target: MemoryTarget; path: string; text: string; entries: string[] }> = [];
  for (const target of ["user", "memory"] as const) {
    const path = paths[target];
    const read = readTarget(path);
    if (!read.ok || read.drift || read.entries.length === 0) {
      if (!read.ok || read.drift) {
        throw new Error(read.error ?? `memory file ${path} does not round-trip through the memory tool`);
      }
      continue;
    }
    out.push({
      target,
      path,
      text: renderBlock(target, read.entries.map(sanitizeEntry), limits[target]),
      entries: read.entries,
    });
  }
  return { blocks: out };
}

export async function mutateTarget(
  value: unknown,
  limits: MemoryLimits = DEFAULT_LIMITS,
): Promise<MutationResult> {
  const input = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const target = input.target;
  if (target !== "user" && target !== "memory") return { success: false, error: "target must be user or memory" };
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  if (target === "memory" && cwd.trim() === "") {
    return { success: false, target, error: "the memory target needs the session working directory" };
  }
  const parsed = readOperations(input);
  if ("error" in parsed) return { success: false, target, error: parsed.error };
  const path = pathsFor(cwd.trim() === "" ? process.cwd() : cwd)[target];
  return await withFileLock(path, (): MutationResult => {
    const read = readTarget(path);
    if (!read.ok) {
      return { success: false, target, error: `memory file could not be read: ${read.error ?? path}` };
    }
    if (read.drift) {
      let saved = "";
      try {
        saved = backup(path, read.raw);
      } catch {
      }
      return {
        success: false,
        target,
        error: `refusing to overwrite ${path}: the file does not round-trip through the memory tool${saved === "" ? "" : `; backup saved to ${saved}`}`,
      };
    }
    const applied = applyOperations(read.entries, parsed.operations, limits[target]);
    if (!applied.success) {
      return {
        success: false,
        target,
        usage: usageOf(applied.entries, limits[target]),
        error: applied.error,
        ...(parsed.operations.length === 1 ? { current_entries: applied.entries } : {}),
      };
    }
    writeAtomic(path, entriesText(applied.entries));
    return {
      success: true,
      done: true,
      target,
      usage: usageOf(applied.entries, limits[target]),
      entry_count: applied.entries.length,
      message: applied.message,
    };
  });
}