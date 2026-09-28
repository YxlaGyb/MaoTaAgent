import assert from "node:assert/strict";

import { JobRegistry } from "../src/registry.ts";

const events: string[] = [];
const registry = new JobRegistry(
  { per_owner: 2, total: 4, runningBytes: 1024, settledBytes: 256 },
  (topic) => events.push(topic),
  async () => {},
);
const { id } = registry.register({ kind: "shell", label: "test", owner: "s", producer: "shell", producer_job_id: "p1" });
registry.append({ id, text: "hello", channel: "stdout" });
const read = registry.read(id, "s");
assert.equal(read.chunks.map((chunk) => chunk.text).join(""), "hello");
const waiting = registry.wait(id, "s", 1000);
assert.equal((await registry.kill(id, "s", "test")).outcome, "requested");
registry.settle({ id, status: "killed", detail: "test" });
await waiting;
assert.ok(events.includes("jobs.settled"));
assert.equal(registry.get(id, "s").status, "killed");
console.log("jobs smoke ok");