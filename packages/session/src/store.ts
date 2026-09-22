import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  type Dirent,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import {
  eventsOf,
  validateTodos,
  viewOf,
  type SessionEvent,
  type TodosSnapshotEvent,
  type TodosView,
} from "./plan.ts";

export const SCHEMA_VERSION = 4;
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DEFAULT_DIRNAME = "default";

/// A message the harness wrote for the model rather than a person typed: the
/// skill catalog is the only one today, and it is durable so a later turn can
/// tell whether the catalog it would send still matches the one in history.
export interface SkillCatalogSource {
  kind: "skill-catalog";
  update?: boolean;
  entries: Array<{ name: string; description: string }>;
}

export type MessageSource = SkillCatalogSource;

export interface SessionMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  source?: MessageSource;
}

/// The durable format is a whitelist: a field this build does not know is not
/// written back, and a source it cannot read is either refused (a write) or
/// dropped (a read), so a hand-edited document cannot smuggle a shape into the
/// rest of the deployment.
export function messageSource(value: unknown): MessageSource | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.kind !== "skill-catalog") return null;
  if (input.update !== undefined && typeof input.update !== "boolean") return null;
  if (!Array.isArray(input.entries)) return null;
  const entries: Array<{ name: string; description: string }> = [];
  for (const raw of input.entries) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as { name?: unknown; description?: unknown };
    if (typeof entry.name !== "string" || typeof entry.description !== "string") return null;
    entries.push({ name: entry.name, description: entry.description });
  }
  return {
    kind: "skill-catalog",
    ...(input.update === undefined ? {} : { update: input.update }),
    entries,
  };
}

function projectMessage(raw: unknown, strict: boolean): SessionMessage | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.role !== "string" || input.role === "") return null;
  const source = messageSource(input.source);
  if (source === null && input.source !== undefined && strict) {
    throw new CallError(-32602, `message source ${JSON.stringify(input.source)} is not one this build knows`);
  }
  const message: SessionMessage = { role: input.role };
  if (typeof input.content === "string" || input.content === null) message.content = input.content;
  if (Array.isArray(input.tool_calls)) message.tool_calls = input.tool_calls;
  if (typeof input.tool_call_id === "string") message.tool_call_id = input.tool_call_id;
  if (typeof input.name === "string") message.name = input.name;
  if (source !== null) message.source = source;
  return message;
}

export function projectMessages(value: unknown, strict: boolean): SessionMessage[] {
  if (!Array.isArray(value)) return [];
  const out: SessionMessage[] = [];
  for (const raw of value) {
    const message = projectMessage(raw, strict);
    if (message !== null) out.push(message);
  }
  return out;
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
  max_events: number;
}

/// How many plan events one document keeps before the older ones are folded
/// into a single snapshot.
export const DEFAULT_MAX_EVENTS = 1000;

export type Warner = (message: string, data?: Record<string, unknown>) => void;

let warner: Warner = (message, data) => console.warn(message, data ?? "");

/// Where a document this build could not read, or a lock it had to take over,
/// is reported. The capability points this at its own log line, so a host that
/// watches the kernel sees it like any other warning.
export function setWarner(fn: Warner | null): void {
  warner = fn ?? ((message, data) => console.warn(message, data ?? ""));
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

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

function lockIsStale(lock: string): boolean {
  const stats = statSync(lock, { throwIfNoEntry: false });
  if (stats === undefined) return true;
  if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) return true;
  let pid = 0;
  try {
    pid = Number.parseInt(readFileSync(lock, "utf8").split("\n")[0] ?? "", 10);
  } catch {
    return true;
  }
  return !alive(pid);
}

/// A document is guarded across processes, not only inside this one. The lock
/// is a sibling file created with `wx`, so a second host pointed at the same
/// `$MAOTA_HOME` waits its turn instead of renaming over a write it never read.
/// A lock whose owner is gone, or that is older than the stale window, is taken
/// over; one still held when the wait window runs out is an error, never an
/// interleave.
function withLock<T>(path: string, work: () => T): T {
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(dirname(path), { recursive: true });
  for (;;) {
    try {
      const handle = openSync(lock, "wx", 0o600);
      try {
        writeSync(handle, `${process.pid}\n${Date.now()}`);
      } finally {
        closeSync(handle);
      }
      try {
        return work();
      } finally {
        rmSync(lock, { force: true });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    if (lockIsStale(lock)) {
      warner(`session document ${path} held a lock left behind by another writer; taking it over`);
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new CallError(-32603, `session document stayed locked for ${LOCK_WAIT_MS}ms; another writer is busy`);
    }
    pause(25);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

type Read =
  | { state: "missing" }
  | { state: "bad"; reason: string }
  | { state: "ok"; file: SessionFile };

function inspect(path: string): Read {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return (error as { code?: string }).code === "ENOENT"
      ? { state: "missing" }
      : { state: "bad", reason: messageOf(error) };
  }
  try {
    const parsed = JSON.parse(text) as SessionFile & { schema_version?: unknown };
    if (typeof parsed?.id !== "string" || !Array.isArray(parsed.messages)) {
      return { state: "bad", reason: "the document has no id and messages" };
    }
    const version = parsed.schema_version;
    if (version !== undefined && ![1, 2, 3, SCHEMA_VERSION].includes(version)) {
      return { state: "bad", reason: `schema_version ${JSON.stringify(version)} is not one this build reads` };
    }
    const events = eventsOf((parsed as { events?: unknown }).events);
    if (events === null) return { state: "bad", reason: "the event list is not a list of plan events" };
    return {
      state: "ok",
      file: {
        ...parsed,
        schema_version: SCHEMA_VERSION,
        messages: projectMessages(parsed.messages, false),
        events,
        parent: parentOf((parsed as { parent?: unknown }).parent),
        dangling: false,
      },
    };
  } catch (error) {
    return { state: "bad", reason: messageOf(error) };
  }
}

/// A document this build cannot read is set aside instead of being read as a
/// fresh session: the next `save` would otherwise write over a file that holds
/// somebody's transcript. The unreadable one is renamed out of the way, where a
/// person can find it, and named in a warning.
function quarantine(path: string, reason: string): void {
  const aside = `${path}.bad-${Date.now()}`;
  try {
    renameSync(path, aside);
    warner(`session document ${path} could not be read (${reason}); moved to ${aside}`);
  } catch (error) {
    warner(`session document ${path} could not be read (${reason}) and could not be moved aside`, {
      error: messageOf(error),
    });
  }
}

function readFileAt(path: string): SessionFile | null {
  const read = inspect(path);
  if (read.state === "bad") {
    quarantine(path, read.reason);
    return null;
  }
  return read.state === "ok" ? read.file : null;
}

/// The listing is an index the writers keep current, because walking every
/// working directory on every `list` only gets more expensive as the tree
/// grows. A missing or unreadable index is rebuilt from the documents
/// themselves, so the file is an accelerator and never the only copy of the
/// truth.
const INDEX_NAME = "index.json";
const MAX_SCAN_DEPTH = 4;

function summaryOf(file: SessionFile): SessionSummary {
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

function readIndex(root: string): SessionSummary[] | null {
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

function rebuildIndex(root: string): SessionSummary[] {
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

function upsertIndex(root: string, entry: SessionSummary): void {
  const sessions = readIndex(root) ?? rebuildIndex(root);
  const rest = sessions.filter((item) => !(item.id === entry.id && sameCwd(item.cwd, entry.cwd)));
  writeIndex(root, [...rest, entry]);
}

function dropIndex(root: string, id: string, cwd: string): void {
  const sessions = readIndex(root) ?? rebuildIndex(root);
  writeIndex(
    root,
    sessions.filter((item) => !(item.id === id && sameCwd(item.cwd, cwd))),
  );
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

/// A document keeps the events that built its plan, which without a ceiling
/// means every write of the same plan stays in the file forever. Past the
/// ceiling the older ones are folded into one snapshot, so the projection still
/// reads the last list written while the document stops growing without bound.
function foldEvents(file: SessionFile, max: number): SessionFile {
  const ceiling = Math.max(2, max);
  if (file.events.length <= ceiling) return file;
  const last = file.events[file.events.length - 1];
  const snapshot: TodosSnapshotEvent = {
    kind: "todos.snapshot",
    at: last?.at ?? file.updated_at,
    todos: last?.todos ?? [],
  };
  return { ...file, events: [snapshot, ...file.events.slice(file.events.length - (ceiling - 1))] };
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
