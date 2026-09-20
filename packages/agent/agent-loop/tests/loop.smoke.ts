import assert from "node:assert/strict";

import { asText, parseArgs, runLoop, toolCalls, type LoopEvent, type Message } from "../src/index.ts";

function recorder(): { events: LoopEvent[]; emit: (event: LoopEvent) => void } {
  const events: LoopEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

function trace(events: readonly LoopEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "step") return [`step:${event.step}`];
    if (event.type === "tool_call") return [`call:${event.tool}@${event.id}`];
    if (event.type === "tool_result") return [`result:${event.tool}@${event.id}:${event.ok}`];
    return [];
  });
}

function calls(...names: Array<[string, string]>): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: names.map(([id, name]) => ({ id, function: { name, arguments: "{}" } })),
  };
}


const silent = () => {};

{
  const seen = recorder();
  const deltas: string[] = [];
  const messages: Message[] = [{ role: "user", content: "hi" }];
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 4,
      chat: async (step) => {
        step.delta({ text: "he" });
        step.delta({ reasoning: "why" });
        step.delta({ text: "llo" });
        return { role: "assistant", content: "hello" };
      },
      callTool: async () => null,
    },
    messages,
    new AbortController().signal,
    (event) => {
      if (event.type === "text") deltas.push(`text:${event.text}`);
      else if (event.type === "reasoning") deltas.push(`reasoning:${event.text}`);
      seen.emit(event);
    },
  );
  assert.deepEqual(outcome, { steps: 1, text: "hello", reason: "completed" });
  assert.deepEqual(deltas, ["text:he", "reasoning:why", "text:llo"]);
  assert.deepEqual(trace(seen.events), ["step:1"]);
  assert.deepEqual(messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
}

{
  const seen = recorder();
  const messages: Message[] = [{ role: "user", content: "hi" }];
  const ran: Array<{ id: string; name: string; args: unknown }> = [];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 4,
      chat: async () => {
        asked += 1;
        if (asked === 1) return calls(["a", "first"], ["b", "second"]);
        return { role: "assistant", content: "done" };
      },
      callTool: async (call) => {
        ran.push({ id: call.id, name: call.name, args: call.args });
        return `${call.name}-out`;
      },
    },
    messages,
    new AbortController().signal,
    seen.emit,
  );
  assert.equal(outcome.reason, "completed");
  assert.equal(outcome.steps, 2);
  assert.deepEqual(ran, [
    { id: "a", name: "first", args: {} },
    { id: "b", name: "second", args: {} },
  ]);
  assert.deepEqual(
    messages.filter((message) => message.role === "tool"),
    [
      { role: "tool", tool_call_id: "a", name: "first", content: "first-out" },
      { role: "tool", tool_call_id: "b", name: "second", content: "second-out" },
    ],
  );
  assert.deepEqual(trace(seen.events), [
    "step:1",
    "call:first@a",
    "result:first@a:true",
    "call:second@b",
    "result:second@b:true",
    "step:2",
  ]);
}

{
  const messages: Message[] = [{ role: "user", content: "hi" }];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 4,
      chat: async () => {
        asked += 1;
        if (asked === 1) return calls(["a", "boom"], ["b", "fine"]);
        return { role: "assistant", content: "recovered" };
      },
      callTool: async (call) => {
        if (call.name === "boom") throw new Error("kaboom");
        return "ok";
      },
    },
    messages,
    new AbortController().signal,
    silent,
  );
  assert.equal(outcome.reason, "completed");
  assert.equal(outcome.text, "recovered");
  assert.deepEqual(
    messages.filter((message) => message.role === "tool").map((message) => message.content),
    ['{"error":"kaboom"}', "ok"],
  );
}

{
  const seen = recorder();
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 3,
      chat: async () => {
        asked += 1;
        return calls([`c${asked}`, "again"]);
      },
      callTool: async () => "ok",
    },
    [{ role: "user", content: "go" }],
    new AbortController().signal,
    seen.emit,
  );
  assert.deepEqual(outcome, { steps: 3, text: "", reason: "max_steps" });
  assert.equal(asked, 3);
  assert.deepEqual(trace(seen.events), [
    "step:1",
    "call:again@c1",
    "result:again@c1:true",
    "step:2",
    "call:again@c2",
    "result:again@c2:true",
    "step:3",
    "call:again@c3",
    "result:again@c3:true",
  ]);
}

{
  const controller = new AbortController();
  controller.abort();
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 3,
      chat: async () => {
        asked += 1;
        return { role: "assistant", content: "never" };
      },
      callTool: async () => null,
    },
    [{ role: "user", content: "go" }],
    controller.signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 0, text: "", reason: "aborted" });
  assert.equal(asked, 0);
}

{
  const controller = new AbortController();
  const messages: Message[] = [{ role: "user", content: "go" }];
  const ran: string[] = [];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 3,
      chat: async () => {
        asked += 1;
        return calls(["a", "first"], ["b", "second"]);
      },
      callTool: async (call) => {
        ran.push(call.name);
        controller.abort();
        return "ok";
      },
    },
    messages,
    controller.signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 1, text: "", reason: "aborted" });
  assert.deepEqual(ran, ["first"]);
  assert.equal(asked, 1);
  assert.equal(messages.filter((message) => message.role === "tool").length, 1);
}

{
  const seen = recorder();
  const ran: string[] = [];
  let live = 0;
  let peak = 0;
  let asked = 0;
  const messages: Message[] = [{ role: "user", content: "go" }];
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      max_parallel: 2,
      classify: async (call) => call.name !== "write",
      chat: async () => {
        asked += 1;
        if (asked === 1) {
          return calls(["a", "read"], ["b", "read"], ["c", "write"], ["d", "read"], ["e", "read"]);
        }
        return { role: "assistant", content: "done" };
      },
      callTool: async (call) => {
        ran.push(call.id);
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live -= 1;
        return `${call.id}-out`;
      },
    },
    messages,
    new AbortController().signal,
    seen.emit,
  );
  assert.equal(outcome.reason, "completed");
  assert.deepEqual(ran, ["a", "b", "c", "d", "e"]);
  assert.equal(peak, 2);
  assert.deepEqual(trace(seen.events), [
    "step:1",
    "call:read@a",
    "call:read@b",
    "result:read@a:true",
    "result:read@b:true",
    "call:write@c",
    "result:write@c:true",
    "call:read@d",
    "call:read@e",
    "result:read@d:true",
    "result:read@e:true",
    "step:2",
  ]);
  assert.deepEqual(
    messages.filter((message) => message.role === "tool").map((message) => `${message.tool_call_id}:${message.content}`),
    ["a:a-out", "b:b-out", "c:c-out", "d:d-out", "e:e-out"],
  );
}

{
  const messages: Message[] = [{ role: "user", content: "go" }];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      max_parallel: 4,
      classify: async (call) => call.name === "safe",
      chat: async () => {
        asked += 1;
        if (asked === 1) return calls(["a", "safe"], ["b", "safe"], ["c", "risky"], ["d", "safe"]);
        return { role: "assistant", content: "done" };
      },
      callTool: async (call) => `${call.id}-out`,
    },
    messages,
    new AbortController().signal,
    silent,
  );
  assert.equal(outcome.reason, "completed");
  assert.deepEqual(
    messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    ["a", "b", "c", "d"],
  );
}

{
  const controller = new AbortController();
  const messages: Message[] = [{ role: "user", content: "go" }];
  const ran: string[] = [];
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      max_parallel: 2,
      classify: async () => true,
      chat: async () =>
        ran.length === 0 ? calls(["a", "one"], ["b", "two"], ["c", "three"]) : { role: "assistant", content: "done" },
      callTool: async (call) => {
        ran.push(call.id);
        controller.abort();
        return `${call.id}-out`;
      },
    },
    messages,
    controller.signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 1, text: "", reason: "aborted" });
  assert.deepEqual(ran, ["a", "b"]);
  assert.deepEqual(
    messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    ["a", "b"],
  );
}

for (const [label, classify] of [
  ["no classifier", undefined],
  ["a throwing classifier", async () => {
    throw new Error("nope");
  }],
  ["a classifier that answers something else", async () => "yes"],
] as Array<[string, undefined | (() => Promise<unknown>)]>) {
  let live = 0;
  let peak = 0;
  const messages: Message[] = [{ role: "user", content: "go" }];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      max_parallel: 4,
      ...(classify === undefined ? {} : { classify: classify as () => Promise<boolean> }),
      chat: async () => {
        asked += 1;
        if (asked === 1) return calls(["a", "one"], ["b", "two"]);
        return { role: "assistant", content: "done" };
      },
      callTool: async (call) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live -= 1;
        return `${call.id}-out`;
      },
    },
    messages,
    new AbortController().signal,
    silent,
  );
  assert.equal(outcome.reason, "completed", label);
  assert.equal(peak, 1, `${label} should have run one call at a time`);
}

for (const [label, reply] of [
  ["no tool_calls", { role: "assistant", content: "plain" }],
  ["an empty tool_calls array", { role: "assistant", content: "plain", tool_calls: [] }],
  ["a call without a name", { role: "assistant", content: "plain", tool_calls: [{ id: "a" }] }],
] as Array<[string, Message]>) {
  const seen = recorder();
  const outcome = await runLoop(
    { tools: [], max_steps: 2, chat: async () => reply, callTool: async () => null },
    [{ role: "user", content: "hi" }],
    new AbortController().signal,
    seen.emit,
  );
  assert.deepEqual(outcome, { steps: 1, text: "plain", reason: "completed" }, label);
  assert.deepEqual(trace(seen.events), ["step:1"], label);
}

assert.deepEqual(toolCalls({ role: "assistant", tool_calls: "nope" as unknown as unknown[] }), []);
assert.deepEqual(toolCalls({ role: "assistant", tool_calls: [{ function: { name: "t" } }] }), [
  { id: "call_0", name: "t", args: {} },
]);
assert.deepEqual(parseArgs("not json"), { raw: "not json" });
assert.deepEqual(parseArgs(""), {});
assert.deepEqual(parseArgs(undefined), {});
assert.equal(asText("text"), "text");
assert.equal(asText({ a: 1 }), '{"a":1}');
assert.equal(asText(undefined), "null");

console.log("agent loop ok: completed, max_steps, aborted, batching, ordering, parsing");