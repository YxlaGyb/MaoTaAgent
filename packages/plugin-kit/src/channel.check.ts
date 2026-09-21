import assert from "node:assert/strict";

import { Channel, matchesTopic } from "./channel.ts";

assert.equal(matchesTopic("demo.*", "demo.turn"), true);
assert.equal(matchesTopic("demo.*", "demo.turn.started"), false);
assert.equal(matchesTopic("demo.*", "loops.turn"), false);
assert.equal(matchesTopic("demo.turn", "demo.turn"), true);
assert.equal(matchesTopic("demo.turn", "demo.turn.started"), false);
assert.equal(matchesTopic("*.*", "demo.turn"), true);
assert.equal(matchesTopic("*.*", "demo"), false);
assert.equal(matchesTopic("kernel.plugin.*", "kernel.plugin.started"), true);
assert.equal(matchesTopic("kernel.plugin.*", "kernel.plugin.a.b"), false);
assert.equal(matchesTopic("**", "a"), false);
assert.equal(matchesTopic("permission.*", "permission.requested"), true);
assert.equal(matchesTopic("permission.*", "permission.settled"), true);
assert.equal(matchesTopic("permission.*", "permission.settled.extra"), false);

interface Wire {
  receive(frame: unknown): void;
  direct(method: string, params: unknown): Promise<unknown>;
}

const channel = new Channel({ request: () => {}, notification: () => {}, event: () => {} });
const wire = channel as unknown as Wire;
const sent: string[] = [];
const seen: Array<[string, number, unknown]> = [];
const handler = (topic: string, seq: number, payload: unknown): void => {
  seen.push([topic, seq, payload]);
};

await assert.rejects(channel.subscribe([], handler), /at least one pattern/);

wire.direct = (method, params) => {
  sent.push(method);
  assert.deepEqual(params, { patterns: ["permission.*"] });
  return Promise.resolve({ subscription_id: "sub-7" });
};
const id = await channel.subscribe(["permission.*"], handler);
assert.deepEqual(sent, ["kernel.subscribe"]);

const event = (topic: string, seq: number, payload: unknown): unknown => ({
  jsonrpc: "2.0",
  method: "$/event",
  params: { topic, seq, payload },
});
wire.receive(event("permission.requested", 3, { id: "r1" }));
assert.deepEqual(seen, [["permission.requested", 3, { id: "r1" }]]);
wire.receive(event("permission.requested.extra", 4, { id: "r2" }));
assert.equal(seen.length, 1, "a topic with more segments than the pattern must not be delivered");
wire.receive(event("tools.changed", 5, {}));
assert.equal(seen.length, 1, "an unmatched topic must not be delivered");

wire.direct = (method, params) => {
  sent.push(method);
  assert.deepEqual(params, { subscription_id: "sub-7" });
  return Promise.resolve({});
};
await channel.unsubscribe(id);
assert.deepEqual(sent, ["kernel.subscribe", "kernel.unsubscribe"]);
wire.receive(event("permission.requested", 6, { id: "r3" }));
assert.equal(seen.length, 1, "an unsubscribed handler must not be called");

await channel.unsubscribe(id);
assert.deepEqual(sent, ["kernel.subscribe", "kernel.unsubscribe"], "unsubscribing twice must not ask again");

const before = sent.length;
await channel.unsubscribe("s-99");
assert.equal(sent.length, before, "an unknown subscription id must not reach the kernel");

let attempted = 0;
wire.direct = () => {
  attempted += 1;
  return Promise.reject(new Error("the kernel refused the subscription"));
};
await assert.rejects(channel.subscribe(["permission.*"], handler), /refused the subscription/);
assert.equal(attempted, 1);
wire.receive(event("permission.requested", 7, { id: "r4" }));
assert.equal(seen.length, 1, "a refused subscription must leave no handler behind");

let asked = 0;
wire.direct = () => {
  asked += 1;
  return Promise.resolve({});
};
const idless = await channel.subscribe(["permission.*"], handler);
assert.equal(asked, 1);
wire.receive(event("permission.requested", 8, { id: "r5" }));
assert.equal(seen.length, 2, "a subscription that got no kernel id still delivers");
await channel.unsubscribe(idless);
assert.equal(asked, 1, "a subscription with no kernel id has nothing to unsubscribe");

console.log("ok   plugin-kit channel: event patterns, subscribe and unsubscribe");
