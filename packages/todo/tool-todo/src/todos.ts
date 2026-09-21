import { ToolArgsError } from "@maota/plugin-kit";

export const PLAN_STATUSES = ["pending", "in_progress", "completed"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface TodoItem {
  content: string;
  status: PlanStatus;
}

export interface PlanCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

export interface PlanView {
  revision: number;
  updated_at: string | null;
  todos: TodoItem[];
  counts: PlanCounts;
}

export interface PlanLimits {
  max_items: number;
  max_content_chars: number;
}

export interface NudgePolicy {
  verify_nudge: boolean;
  verify_min_items: number;
}

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUSES as readonly string[]).includes(value);
}

export function checkTodos(todos: unknown, limits: PlanLimits): TodoItem[] {
  if (!Array.isArray(todos)) throw new ToolArgsError(["todos must be an array"]);
  const violations: string[] = [];
  if (todos.length > limits.max_items) {
    violations.push(`todos carries ${todos.length} items, over the max_items of ${limits.max_items}`);
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
      if (key !== "content" && key !== "status") violations.push(`${at}.${key} is not part of a todo item`);
    }
    const problems: string[] = [];
    const content = item.content;
    if (typeof content !== "string") problems.push(`${at}.content must be a string`);
    else if (content.trim() === "") problems.push(`${at}.content must not be blank`);
    else if (content.length > limits.max_content_chars) {
      problems.push(
        `${at}.content is ${content.length} characters, over the max_content_chars of ${limits.max_content_chars}`,
      );
    }
    if (!isPlanStatus(item.status)) problems.push(`${at}.status must be one of ${PLAN_STATUSES.join(", ")}`);
    violations.push(...problems);
    if (problems.length === 0) items.push({ content: content as string, status: item.status as PlanStatus });
  });
  if (violations.length > 0) throw new ToolArgsError(violations);
  return items;
}

export function acknowledgement(view: PlanView): string {
  const counts = view.counts;
  return (
    `plan updated: ${view.todos.length} tasks, ` +
    `${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed ` +
    `(revision ${view.revision})`
  );
}

export function verificationNudge(todos: readonly TodoItem[], policy: NudgePolicy): string | null {
  if (!policy.verify_nudge) return null;
  if (todos.length < policy.verify_min_items) return null;
  if (!todos.every((todo) => todo.status === "completed")) return null;
  return (
    "every item is completed. Before you report the work as done, verify it: run the check that proves the result, " +
    "and say what you ran and what it returned. If verification still has steps, keep them in the list as in progress."
  );
}
