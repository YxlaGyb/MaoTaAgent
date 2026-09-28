import assert from "node:assert/strict";

import { TurnQueue } from "../src/queue.ts";
import type { TurnResult } from "../src/types.ts";

const order: string[] = [];
const queue = new TurnQueue({ maxParallel: 1, maxSystem: 1, wakeBudget: 0 }, async (entry) => {
  order.push(entry.input.input);
  return { turn_id: entry.id, session_id: entry.input.session_id, text: entry.input.input, reason: "completed", steps: 1 } satisfies TurnResult;
});
const system = queue.submit({ session_id: "s", cwd: "", input: "system", source: { kind: "job", id: "j1" } }, true);
const user = queue.submit({ session_id: "s", cwd: "", input: "user", source: { kind: "user" } }, true);
await Promise.all([system.done, user.done]);
assert.deepEqual(order, ["user", "system"]);
assert.equal(queue.status("s").deferred, 0);
console.log("runner smoke ok");