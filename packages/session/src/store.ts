import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import { eventsOf, validateTodos, viewOf, type SessionEvent, type TodosView } from "./plan.ts";

export const SCHEMA_VERSION = 3;
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DEFAULT_DIRNAME = "default";

export interface SessionMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface SessionFile {
  schema_version: number;
  id: string;
  cwd: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: SessionMessage[];
  events: SessionEvent[];
  parent: SessionParent | null;
  dangling: boolean;
}

/// A subagent's link back to the turn that spawned it: the parent session, the
/// tool call that asked for it, and the label that call showed.
export interface SessionParent {
  id: string;
  cwd: string;
  call_id: string;
  type: string;
  description: string;
}

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  created_at: string;
  updated_at: string;
  parent: SessionParent | null;
}

export interface Limits {
  max_bytes: number;
  max_path: number;
}

export function defaultMaxPath(platform: string = process.platform): number {
  return platform === "win32" ? 250 : 4000;
}

export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.MAOTA_HOME;
  return join(home && home.trim() !== "" ? home : join(homedir(), ".maota"), "sessions");
}

export function trimCwd(cwd: string): string {
  return cwd.replace(/[\\/]+$/, "");
}

export function encodeDir(cwd: string): string {
  const trimmed = trimCwd(cwd);
  if (trimmed === "") return DEFAULT_DIRNAME;
  return trimmed.replace(/[^A-Za-z0-9]/g, "-");
}

export function sameCwd(left: string, right: string): boolean {
  return trimCwd(left) === trimCwd(right);
}

const chains = new Map<string, Promise<unknown>>();

export function serially<T>(key: string, work: () => T): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

export function pendingWrites(): number {
  return chains.size;
}

function assertId(id: unknown): string {
  const value = String(id ?? "");
  if (!SESSION_ID.test(value)) {
    throw new CallError(-32602, `session id must match ${SESSION_ID.source}, got ${JSON.stringify(id)}`);
  }
  return value;
}

/// A stored document is read leniently and written strictly: a malformed link
/// inside a file reads as absent, while one this process was handed is a bug
/// worth refusing.
function parentOf(value: unknown): SessionParent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (name: string): string => (typeof raw[name] === "string" ? (raw[name] as string) : "");
  if (typeof raw.id !== "string" || !SESSION_ID.test(raw.id)) return null;
  return {
    id: raw.id,
    cwd: text("cwd"),
    call_id: text("call_id"),
    type: text("type"),
    description: text("description"),
  };
}

function assertParent(value: unknown): SessionParent | null {
  if (value === undefined || value === null) return null;
  const parent = parentOf(value);
  if (parent === null) {
    throw new CallError(-32602, `parent must name the session that spawned this one, got ${JSON.stringify(value)}`);
  }
  return parent;
}

function pathOf(root: string, id: string, cwd: string, limits: Limits): string {
  const path = join(root, encodeDir(cwd), `${id}.json`);
  if (path.length > limits.max_path) {
    throw new CallError(
      -32602,
      `session path is ${path.length} chars, over the max_path limit of ${limits.max_path}: ${path}`,
    );
  }
  return path;
}

function readFileAt(path: string): SessionFile | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as SessionFile & { schema_version?: unknown };
    if (typeof parsed?.id !== "string" || !Array.isArray(parsed.messages)) return null;
    const version = parsed.schema_version;
    if (version !== undefined && ![1, 2, SCHEMA_VERSION].includes(version)) return null;
    const events = eventsOf((parsed as { events?: unknown }).events);
    if (events === null) return null;
    return {
      ...parsed,
      schema_version: SCHEMA_VERSION,
      events,
      parent: parentOf((parsed as { parent?: unknown }).parent),
      dangling: false,
    };
  } catch {
    return null;
  }
}

function assertOwnership(found: SessionFile | null, id: string, cwd: string): void {
  if (!found) return;
  const owner = String(found.cwd ?? "");
  if (sameCwd(owner, cwd)) return;
  throw new CallError(
    -32602,
    `session ${id} already belongs to ${JSON.stringify(owner)}, not ${JSON.stringify(cwd)}; pick another id`,
  );
}

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

function writeDocument(path: string, dir: string, id: string, file: SessionFile, limits: Limits): void {
  const body = JSON.stringify(file);
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
}

export function save(root: string, input: SaveInput, limits: Limits, now = new Date().toISOString()): SessionFile {
  const id = assertId(input.id);
  const workdir = typeof input.cwd === "string" ? input.cwd : "";
  const path = pathOf(root, id, workdir, limits);
  const found = readFileAt(path);
  assertOwnership(found, id, workdir);

  const messages = Array.isArray(input.messages) ? (input.messages as SessionMessage[]) : [];
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

  writeDocument(path, join(root, encodeDir(workdir)), id, file, limits);
  return file;
}

export function write(root: string, id: unknown, cwd: unknown, file: SessionFile, limits: Limits): void {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const path = pathOf(root, safeId, workdir, limits);
  assertOwnership(readFileAt(path), safeId, workdir);
  writeDocument(path, join(root, encodeDir(workdir)), safeId, file, limits);
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
  write(root, input.id, input.cwd, written, limits);
  return viewOf(written.events);
}

export function remove(root: string, id: unknown, cwd: unknown, limits: Limits): boolean {
  const safeId = assertId(id);
  const workdir = typeof cwd === "string" ? cwd : "";
  const path = pathOf(root, safeId, workdir, limits);
  assertOwnership(readFileAt(path), safeId, workdir);
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

export function list(root: string): SessionSummary[] {
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  const found: SessionSummary[] = [];
  for (const dir of dirs) {
    if (dir.startsWith(".")) continue;
    let files: string[];
    try {
      files = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith(".")) continue;
      const parsed = readFileAt(join(root, dir, file));
      if (!parsed) continue;
      if (parsed.parent !== null) continue;
      found.push({
        id: String(parsed.id),
        cwd: String(parsed.cwd ?? ""),
        title: String(parsed.title ?? ""),
        created_at: String(parsed.created_at ?? ""),
        updated_at: String(parsed.updated_at ?? ""),
        parent: parsed.parent,
      });
    }
  }
  return found.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
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
