import { CallError } from "@maota/plugin-kit";

export const MAX_TODO_ITEMS = 256;
export const MAX_TODO_CONTENT_CHARS = 2000;
export const MAX_RETRY_REASON_CHARS = 400;

export type TodoStatus = "pending" | "in_progress" | "completed";

export const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface PlanCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

export interface TodosView {
  revision: number;
  updated_at: string | null;
  todos: TodoItem[];
  counts: PlanCounts;
}

export interface TodosEvent {
  kind: "todos.write";
  at: string;
  todos: TodoItem[];
}

export interface TodosSnapshotEvent {
  kind: "todos.snapshot";
  at: string;
  todos: TodoItem[];
}

export type RetryPhase = "scheduled" | "started" | "given_up";

export const RETRY_PHASES: readonly RetryPhase[] = ["scheduled", "started", "given_up"];

/// A request that failed and was replaced is durable evidence: it is written
/// before the wait starts, so a crash during the wait still leaves the reason
/// and the delay that were about to be spent in the document.
export interface RetryEvent {
  kind: "model.retry";
  at: string;
  phase: RetryPhase;
  step: number;
  attempt: number;
  delay_ms: number;
  failure_kind: string;
  reason: string;
}

export type SessionEvent = TodosEvent | TodosSnapshotEvent | RetryEvent;

export function isRetryEvent(event: SessionEvent): event is RetryEvent {
  return event.kind === "model.retry";
}

export function isPlanEvent(event: SessionEvent): event is TodosEvent | TodosSnapshotEvent {
  return event.kind !== "model.retry";
}

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

export function isRetryPhase(value: unknown): value is RetryPhase {
  return typeof value === "string" && (RETRY_PHASES as readonly string[]).includes(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/// The plugin reads this argument off the wire, so every field it keeps is
/// checked here; the timestamp is the one exception, since a caller that omits
/// it means now.
export function retryEventOf(value: unknown): RetryEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CallError(-32602, `a retry event must be an object, got ${JSON.stringify(value)}`);
  }
  const raw = value as Record<string, unknown>;
  if (!isRetryPhase(raw.phase)) {
    throw new CallError(-32602, `a retry phase must be one of ${RETRY_PHASES.join(", ")}`);
  }
  if (typeof raw.failure_kind !== "string" || raw.failure_kind.trim() === "") {
    throw new CallError(-32602, "a retry event must name the failure kind it replaces");
  }
  const reason = raw.reason;
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new CallError(-32602, "a retry event must say why the attempt was replaced");
  }
  if (reason.length > MAX_RETRY_REASON_CHARS) {
    throw new CallError(
      -32602,
      `a retry reason is ${reason.length} characters, over the ${MAX_RETRY_REASON_CHARS} character ceiling`,
    );
  }
  return {
    kind: "model.retry",
    at: typeof raw.at === "string" && raw.at !== "" ? raw.at : new Date().toISOString(),
    phase: raw.phase,
    step: count(raw.step),
    attempt: count(raw.attempt),
    delay_ms: count(raw.delay_ms),
    failure_kind: raw.failure_kind,
    reason,
  };
}

export function countsOf(todos: readonly TodoItem[]): PlanCounts {
  const counts: PlanCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const todo of todos) counts[todo.status] += 1;
  return counts;
}

export function viewOf(events: readonly SessionEvent[]): TodosView {
  const plan = events.filter(isPlanEvent);
  const last = plan.at(-1) ?? null;
  const todos = last?.todos ?? [];
  return {
    revision: plan.length,
    updated_at: last?.at ?? null,
    todos,
    counts: countsOf(todos),
  };
}

export function validateTodos(todos: unknown): TodoItem[] {
  if (!Array.isArray(todos)) {
    throw new CallError(-32602, `todos must be an array, got ${JSON.stringify(todos)}`);
  }
  const violations: string[] = [];
  if (todos.length > MAX_TODO_ITEMS) {
    violations.push(`todos carries ${todos.length} items, over the ${MAX_TODO_ITEMS} item ceiling`);
  }
  const items: TodoItem[] = [];
  todos.forEach((raw, index) => {
    const at = `todos[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      violations.push(`${at} must be an object`);
      return;
    }
    const item = raw as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (key !== "content" && key !== "status") violations.push(`${at}.${key} is not a todo field`);
    }
    const problems: string[] = [];
    const content = item.content;
    if (typeof content !== "string") problems.push(`${at}.content must be a string`);
    else if (content.trim() === "") problems.push(`${at}.content must not be blank`);
    else if (content.length > MAX_TODO_CONTENT_CHARS) {
      problems.push(`${at}.content is ${content.length} characters, over the ${MAX_TODO_CONTENT_CHARS} character ceiling`);
    }
    if (!isTodoStatus(item.status)) problems.push(`${at}.status must be one of ${TODO_STATUSES.join(", ")}`);
    violations.push(...problems);
    if (problems.length === 0) items.push({ content: content as string, status: item.status as TodoStatus });
  });
  if (violations.length > 0) {
    throw new CallError(-32602, `invalid todos: ${violations.join("; ")}`, {
      code: "INVALID_TODOS",
      violations,
    });
  }
  return items;
}

export function eventOf(value: unknown): SessionEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "model.retry") {
    try {
      return retryEventOf(raw);
    } catch {
      return null;
    }
  }
  if ((raw.kind !== "todos.write" && raw.kind !== "todos.snapshot") || typeof raw.at !== "string") return null;
  const kind: SessionEvent["kind"] = raw.kind === "todos.snapshot" ? "todos.snapshot" : "todos.write";
  try {
    return { kind, at: raw.at, todos: validateTodos(raw.todos) };
  } catch {
    return null;
  }
}

export function eventsOf(value: unknown): SessionEvent[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const events: SessionEvent[] = [];
  for (const raw of value) {
    const event = eventOf(raw);
    if (event !== null) events.push(event);
  }
  return events;
}
