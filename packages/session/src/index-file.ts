/// The listing is an index the writers keep current, because walking every
/// working directory on every `list` only gets more expensive as the tree
/// grows. A missing or unreadable index is rebuilt from the documents
/// themselves, so the file is an accelerator and never the only copy of the
/// truth.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import {
  SESSION_ID,
  inspect,
  parentOf,
  quarantine,
  sameCwd,
  type SessionFile,
  type SessionSummary,
} from "./document.ts";

const INDEX_NAME = "index.json";
const MAX_SCAN_DEPTH = 4;

export function summaryOf(file: SessionFile): SessionSummary {
  return {
    id: file.id,
    cwd: file.cwd,
    title: file.title,
    created_at: file.created_at,
    updated_at: file.updated_at,
    parent: file.parent,
  };
}

function indexPath(root: string): string {
  return join(root, INDEX_NAME);
}

function summaryEntry(value: unknown): SessionSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (name: string): string => (typeof raw[name] === "string" ? (raw[name] as string) : "");
  if (typeof raw.id !== "string" || !SESSION_ID.test(raw.id)) return null;
  return {
    id: raw.id,
    cwd: text("cwd"),
    title: text("title"),
    created_at: text("created_at"),
    updated_at: text("updated_at"),
    parent: parentOf(raw.parent),
  };
}

export function readIndex(root: string): SessionSummary[] | null {
  let text: string;
  try {
    text = readFileSync(indexPath(root), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { sessions?: unknown };
    if (!Array.isArray(parsed.sessions)) return null;
    const sessions: SessionSummary[] = [];
    for (const raw of parsed.sessions) {
      const entry = summaryEntry(raw);
      if (entry === null) return null;
      sessions.push(entry);
    }
    return sessions;
  } catch {
    return null;
  }
}

function writeIndex(root: string, sessions: SessionSummary[]): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(indexPath(root), JSON.stringify({ sessions }), { encoding: "utf8", mode: 0o600 });
}

function collect(dir: string, depth: number, out: SessionSummary[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_SCAN_DEPTH) collect(path, depth + 1, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === INDEX_NAME) continue;
    const read = inspect(path);
    if (read.state === "bad") {
      quarantine(path, read.reason);
      continue;
    }
    if (read.state === "ok") out.push(summaryOf(read.file));
  }
}

export function rebuildIndex(root: string): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    collect(join(root, entry.name), 1, sessions);
  }
  writeIndex(root, sessions);
  return sessions;
}

export function upsertIndex(root: string, entry: SessionSummary): void {
  const sessions = readIndex(root) ?? rebuildIndex(root);
  const rest = sessions.filter((item) => !(item.id === entry.id && sameCwd(item.cwd, entry.cwd)));
  writeIndex(root, [...rest, entry]);
}

export function dropIndex(root: string, id: string, cwd: string): void {
  const sessions = readIndex(root) ?? rebuildIndex(root);
  writeIndex(
    root,
    sessions.filter((item) => !(item.id === id && sameCwd(item.cwd, cwd))),
  );
}

export function assertOwnership(found: SessionFile | null, id: string, cwd: string): void {
  if (!found) return;
  const owner = String(found.cwd ?? "");
  if (sameCwd(owner, cwd)) return;
  throw new CallError(
    -32602,
    `session ${id} already belongs to ${JSON.stringify(owner)}, not ${JSON.stringify(cwd)}; pick another id`,
  );
}
