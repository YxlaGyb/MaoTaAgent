import { isAbsolute, join } from "node:path";

import { toolCalls, type Message, type ToolSpec } from "@maota/agent-loop";

/// How many touched paths one turn carries. A session can touch thousands of
/// files over a long day, and every match a caller checks is a glob run, so the
/// newest few hundred are enough for a conditional skill to switch on.
const TOUCHED_LIMIT = 200;

export interface CatalogEntry {
  name: string;
  description: string;
}

export interface CatalogNote {
  kind: "skill-catalog";
  update: boolean;
  entries: CatalogEntry[];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/// The note as it is stored: a source this build cannot read is not a baseline,
/// so it is skipped instead of half-understood, and a message from an older
/// build simply reads as "no catalog yet".
export function catalogNote(source: unknown): CatalogNote | null {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const input = source as Record<string, unknown>;
  if (input.kind !== "skill-catalog") return null;
  if (input.update !== undefined && typeof input.update !== "boolean") return null;
  if (!Array.isArray(input.entries)) return null;
  const entries: CatalogEntry[] = [];
  for (const raw of input.entries) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as { name?: unknown; description?: unknown };
    const name = text(entry.name);
    if (name === undefined || typeof entry.description !== "string") return null;
    entries.push({ name, description: entry.description });
  }
  return { kind: "skill-catalog", update: input.update === true, entries };
}

/// The newest note in the history is what the model last read. Older notes have
/// already been replaced, and finding none means nothing has been sent yet.
export function lastCatalogEntries(messages: readonly Message[]): CatalogEntry[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const note = catalogNote((messages[index] as Message).source);
    if (note !== null) return note.entries;
  }
  return null;
}

export function sameCatalog(left: readonly CatalogEntry[], right: readonly CatalogEntry[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const one = left[index] as CatalogEntry;
    const other = right[index] as CatalogEntry;
    if (one.name !== other.name || one.description !== other.description) return false;
  }
  return true;
}

/// A replacement is a new durable message rather than an edit, because the past
/// the model already read is part of the record: `update` marks it as replacing
/// an earlier catalog so a reader can tell the two apart.
export function catalogMessage(
  text_: string,
  entries: readonly CatalogEntry[],
  previous: readonly CatalogEntry[] | null,
): Message {
  return {
    role: "user",
    name: "skill-catalog",
    content: text_,
    source: { kind: "skill-catalog", ...(previous === null ? {} : { update: true }), entries: [...entries] },
  };
}

function pathValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function againstCwd(path: string, cwd: string | null): string {
  if (cwd === null || cwd === "" || isAbsolute(path)) return path;
  return join(cwd, path);
}

/// Which files the model has already touched, read back from the tool calls in
/// the history through the paths each tool declared. Nothing here knows what a
/// file tool is: a tool that says which arguments carry a path is enough, and
/// the history is the record, so a restart does not lose it.
export function touchedPaths(
  messages: readonly Message[],
  specs: ReadonlyMap<string, ToolSpec>,
  cwd: string | null,
  limit = TOUCHED_LIMIT,
): string[] {
  const touched: string[] = [];
  for (const message of messages) {
    for (const call of toolCalls(message)) {
      const declared = specs.get(call.name)?.paths;
      if (declared === undefined || declared.length === 0) continue;
      const args = call.args;
      if (args === null || typeof args !== "object" || Array.isArray(args)) continue;
      for (const name of declared) {
        for (const value of pathValues((args as Record<string, unknown>)[name])) {
          touched.push(againstCwd(value, cwd));
        }
      }
    }
  }
  const seen = new Set<string>();
  const newest: string[] = [];
  for (let index = touched.length - 1; index >= 0; index -= 1) {
    const path = touched[index] as string;
    if (seen.has(path)) continue;
    seen.add(path);
    newest.push(path);
    if (newest.length >= limit) break;
  }
  return newest.reverse();
}
