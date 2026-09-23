/// The public face of a session document: the schema version and id shape, the
/// shapes a document and its listing use, and the operations that read and
/// write one. The file-level details live in `document.ts`, the cross-process
/// lock in `lock.ts`, and the listing index in `index-file.ts`; this module
/// re-exports the names callers have always reached for from here.

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import { isPlanEvent, isRetryEvent, validateTodos, viewOf, type RetryEvent, type SessionEvent, type TodosSnapshotEvent, type TodosView } from "./plan.ts";
import {
  SCHEMA_VERSION,
  assertId,
  assertParent,
  encodeDir,
  pathOf,
  projectMessages,
  readFileAt,
  trimCwd,
  type Limits,
  type SessionFile,
  type SessionSummary,
} from "./document.ts";
import { withLock } from "./lock.ts";
import { assertOwnership, dropIndex, readIndex, rebuildIndex, summaryOf, upsertIndex } from "./index-file.ts";

export {
  SCHEMA_VERSION,
  SESSION_ID,
  DEFAULT_DIRNAME,
  DEFAULT_MAX_EVENTS,
  messageSource,
  projectMessages,
  setWarner,
  defaultMaxPath,
  defaultRoot,
  trimCwd,
  encodeDir,
  sameCwd,
} from "./document.ts";

export type {
  SkillCatalogSource,
  MessageSource,
  SessionMessage,
  SessionFile,
  SessionParent,
  SessionSummary,
  Limits,
  Warner,
} from "./document.ts";

export { serially, pendingWrites } from "./lock.ts";

export function load(
  root: string,
  id: unknown,
  cwd: unknown,
  limits: Limits,
  now = new Date().toISOString(),
): SessionFile {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const found = readFileAt(pathOf(root, safeId, workdir, limits));
  assertOwnership(found, safeId, workdir);
  if (!found) {
    return {
      schema_version: SCHEMA_VERSION,
      id: safeId,
      cwd: trimCwd(workdir),
      title: "",
      created_at: now,
      updated_at: now,
      messages: [],
      events: [],
      parent: null,
      dangling: false,
    };
  }
  return { ...found, dangling: found.messages.at(-1)?.role === "user" };
}

export interface SaveInput {
  id: unknown;
  cwd: unknown;
  title?: unknown;
  messages: unknown;
  parent?: unknown;
}

/// A document keeps the events that built its plan, which without a ceiling
/// means every write of the same plan stays in the file forever. Past the
/// ceiling the older ones are folded into one snapshot that still projects the
/// last list written, while the newest ones stay as they were. A retry event
/// carries no plan, so it is never folded into the snapshot: the newest ones
/// are kept as the trail a crash report reads.
function foldEvents(file: SessionFile, max: number): SessionFile {
  const ceiling = Math.max(2, max);
  if (file.events.length <= ceiling) return file;
  const plan = file.events.filter(isPlanEvent);
  const last = plan.at(-1);
  const snapshot: TodosSnapshotEvent = {
    kind: "todos.snapshot",
    at: last?.at ?? file.updated_at,
    todos: last?.todos ?? [],
  };
  return {
    ...file,
    events: [
      snapshot,
      ...plan.slice(-(ceiling - 1)),
      ...file.events.filter(isRetryEvent).slice(-(ceiling - 1)),
    ],
  };
}

function writeDocument(path: string, dir: string, id: string, file: SessionFile, limits: Limits): SessionFile {
  const folded = foldEvents(file, limits.max_events);
  const body = JSON.stringify(folded);
  if (Buffer.byteLength(body, "utf8") > limits.max_bytes) {
    throw new CallError(-32602, `session ${id} is over the ${limits.max_bytes} byte cap; start a new session`);
  }
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${id}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return folded;
}

export function save(root: string, input: SaveInput, limits: Limits, now = new Date().toISOString()): SessionFile {
  const id = assertId(input.id);
  const workdir = typeof input.cwd === "string" ? input.cwd : "";
  const path = pathOf(root, id, workdir, limits);
  const written = withLock(path, () => {
    const found = readFileAt(path);
    assertOwnership(found, id, workdir);

    const messages = projectMessages(input.messages, true);
    const file: SessionFile = {
      schema_version: SCHEMA_VERSION,
      id,
      cwd: trimCwd(workdir),
      title: typeof input.title === "string" && input.title !== "" ? input.title : (found?.title ?? ""),
      created_at: found?.created_at ?? now,
      updated_at: now,
      messages,
      events: found?.events ?? [],
      parent: assertParent(input.parent) ?? found?.parent ?? null,
      dangling: messages.at(-1)?.role === "user",
    };

    return writeDocument(path, join(root, encodeDir(workdir)), id, file, limits);
  });
  upsertIndex(root, summaryOf(written));
  return written;
}

export function write(root: string, id: unknown, cwd: unknown, file: SessionFile, limits: Limits): SessionFile {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const path = pathOf(root, safeId, workdir, limits);
  const written = withLock(path, () => {
    assertOwnership(readFileAt(path), safeId, workdir);
    return writeDocument(path, join(root, encodeDir(workdir)), safeId, file, limits);
  });
  upsertIndex(root, summaryOf(written));
  return written;
}

export function todosOf(
  root: string,
  id: unknown,
  cwd: unknown,
  limits: Limits,
  now = new Date().toISOString(),
): TodosView {
  return viewOf(load(root, id, cwd, limits, now).events);
}

export function appendTodos(
  root: string,
  input: { id: unknown; cwd: unknown; todos: unknown },
  limits: Limits,
  now = new Date().toISOString(),
): TodosView {
  const todos = validateTodos(input.todos);
  const found = load(root, input.id, input.cwd, limits, now);
  const written: SessionFile = {
    ...found,
    schema_version: SCHEMA_VERSION,
    updated_at: now,
    events: [...found.events, { kind: "todos.write", at: now, todos }],
  };
  const stored = write(root, input.id, input.cwd, written, limits);
  return viewOf(stored.events);
}

export function appendEvent(
  root: string,
  input: { id: unknown; cwd: unknown; event: RetryEvent },
  limits: Limits,
): RetryEvent {
  const found = load(root, input.id, input.cwd, limits);
  const written: SessionFile = {
    ...found,
    schema_version: SCHEMA_VERSION,
    updated_at: input.event.at,
    events: [...found.events, input.event],
  };
  write(root, input.id, input.cwd, written, limits);
  return input.event;
}

/// The durable trail a post-mortem reads: the plan events projected as before,
/// plus the request replacements in the order they were scheduled.
export function eventsOf(
  root: string,
  id: unknown,
  cwd: unknown,
  limits: Limits,
): { events: SessionEvent[]; retries: RetryEvent[]; todos: TodosView } {
  const events = load(root, id, cwd, limits).events;
  return { events, retries: events.filter(isRetryEvent), todos: viewOf(events) };
}

export function remove(root: string, id: unknown, cwd: unknown, limits: Limits): boolean {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const path = pathOf(root, safeId, workdir, limits);
  const removed = withLock(path, () => {
    assertOwnership(readFileAt(path), safeId, workdir);
    try {
      rmSync(path);
      return true;
    } catch {
      return false;
    }
  });
  if (removed) dropIndex(root, safeId, workdir);
  return removed;
}

export function list(root: string): SessionSummary[] {
  const found = readIndex(root) ?? rebuildIndex(root);
  return [...found].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

/// The subagents one session spawned, in the order they were created. They sit
/// in the parent's own folder, because a child is handed the parent's working
/// directory and never writes outside it.
export function childrenOf(root: string, id: unknown, cwd: unknown): SessionSummary[] {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const dir = join(root, encodeDir(workdir));
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const found: SessionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const parsed = readFileAt(join(dir, file));
    if (parsed === null || parsed.parent === null || parsed.parent.id !== safeId) continue;
    found.push({
      id: String(parsed.id),
      cwd: String(parsed.cwd ?? ""),
      title: String(parsed.title ?? ""),
      created_at: String(parsed.created_at ?? ""),
      updated_at: String(parsed.updated_at ?? ""),
      parent: parsed.parent,
    });
  }
  return found.sort(
    (left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
}
