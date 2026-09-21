import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  acknowledgement,
  checkTodos,
  isPlanStatus,
  verificationNudge,
  type PlanLimits,
  type PlanView,
  type TodoItem,
} from "../src/todos.ts";

const limits: PlanLimits = { max_items: 3, max_content_chars: 20 };

const list: TodoItem[] = [
  { content: "read the parser", status: "pending" },
  { content: "rename", status: "completed" },
];
assert.deepEqual(checkTodos(list, limits), list);

function violations(todos: unknown, at: PlanLimits = limits): string[] {
  try {
    checkTodos(todos, at);
    return [];
  } catch (error) {
    return (error as { violations?: string[] }).violations ?? [];
  }
}

assert.deepEqual(violations("nope"), ["todos must be an array"]);
assert.deepEqual(violations([{ content: "read" }]), [
  "todos[0].status must be one of pending, in_progress, completed",
]);
assert.deepEqual(violations([{ content: "   ", status: "pending" }]), ["todos[0].content must not be blank"]);
assert.deepEqual(violations([{ content: "x".repeat(21), status: "pending" }]), [
  "todos[0].content is 21 characters, over the max_content_chars of 20",
]);
assert.deepEqual(violations([{ content: 7, status: "pending" }]), ["todos[0].content must be a string"]);
assert.deepEqual(violations([1]), ["todos[0] must be an object"]);
assert.deepEqual(violations(Array.from({ length: 4 }, (_, n) => ({ content: `s${n}`, status: "pending" }))), [
  "todos carries 4 items, over the max_items of 3",
]);

assert.deepEqual(
  violations([
    { content: "", status: "done", activeForm: "doing it" },
    { content: "b" },
  ]),
  [
    "todos[0].activeForm is not part of a todo item",
    "todos[0].content must not be blank",
    "todos[0].status must be one of pending, in_progress, completed",
    "todos[1].status must be one of pending, in_progress, completed",
  ],
);

try {
  checkTodos([{ content: "ok", status: "done" }], limits);
  assert.fail("a bad status was accepted");
} catch (error) {
  assert.match((error as Error).message, /^invalid arguments: todos\[0\]\.status/);
}

assert.deepEqual(isPlanStatus("in_progress"), true);
for (const value of ["done", "", 1, null, undefined, "PENDING"]) {
  assert.equal(isPlanStatus(value), false);
}

const view: PlanView = {
  revision: 7,
  updated_at: "2026-01-01T00:00:00.000Z",
  todos: list,
  counts: { pending: 1, in_progress: 0, completed: 1 },
};
assert.equal(acknowledgement(view), "plan updated: 2 tasks, 1 pending, 0 in progress, 1 completed (revision 7)");
assert.equal(
  acknowledgement({ ...view, revision: 0, todos: [], counts: { pending: 0, in_progress: 0, completed: 0 } }),
  "plan updated: 0 tasks, 0 pending, 0 in progress, 0 completed (revision 0)",
);

const done: TodoItem[] = [
  { content: "a", status: "completed" },
  { content: "b", status: "completed" },
  { content: "c", status: "completed" },
];
const nudge = { verify_nudge: true, verify_min_items: 3 };
assert.match(String(verificationNudge(done, nudge)), /^every item is completed/);
assert.equal(verificationNudge(done.slice(0, 2), nudge), null, "two items are below the floor");
assert.equal(
  verificationNudge([...done.slice(0, 2), { content: "c", status: "in_progress" }], nudge),
  null,
  "an unfinished item holds the nudge back",
);
assert.equal(verificationNudge([], nudge), null);
assert.equal(verificationNudge(done, { ...nudge, verify_nudge: false }), null);
assert.equal(verificationNudge(done, { ...nudge, verify_min_items: 4 }), null);

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
const report = JSON.parse(line) as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the tool entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the tool selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "tool.todo_write", version: "1.0.0" }]);

console.log("tool-todo ok: the item shape, the ceilings, the acknowledgement, the nudge and the entry --check report");
