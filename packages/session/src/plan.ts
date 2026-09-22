import { CallError } from "@maota/plugin-kit";

export const MAX_TODO_ITEMS = 256;
export const MAX_TODO_CONTENT_CHARS = 2000;

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

export type SessionEvent = TodosEvent | TodosSnapshotEvent;

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value);
}

export function countsOf(todos: readonly TodoItem[]): PlanCounts {
  const counts: PlanCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const todo of todos) counts[todo.status] += 1;
  return counts;
}

export function viewOf(events: readonly SessionEvent[]): TodosView {
  const last = events.at(-1) ?? null;
  const todos = last?.todos ?? [];
  return {
    revision: events.length,
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
