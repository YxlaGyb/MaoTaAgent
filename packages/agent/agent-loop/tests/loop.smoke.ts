import assert from "node:assert/strict";

import {
  asText,
  batchesOf,
  parseArgs,
  runLoop,
  toolCalls,
  type Disposition,
  type LoopEvent,
  type Message,
} from "../src/index.ts";

function batched(dispositions: readonly Disposition[], maxParallel: number): string[][] {
  return batchesOf(
    dispositions.map((_, index) => ({ id: `c${index}`, name: "t", args: {} })),
    dispositions,
    maxParallel,
  ).map((group) => group.map((call) => call.id));
}

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

assert.deepEqual(
  batched(["parallel", "parallel", "blocked", "parallel", "parallel"], 4),
  [["c0", "c1"], ["c2"], ["c3", "c4"]],
  "a call that runs alone ends the group around it, and its neighbours still batch up to max_parallel",
);
assert.deepEqual(batched(["serial", "serial"], 8), [["c0"], ["c1"]], "a serial call runs alone");
assert.deepEqual(batched(["parallel", "parallel", "parallel"], 2), [["c0", "c1"], ["c2"]]);
assert.deepEqual(batched([], 2), []);

{
  const seen = recorder();
  const messages: Message[] = [{ role: "user", content: "go" }];
  const ran: string[] = [];
  let classified = 0;
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 3,
      classify: async () => {
        classified += 1;
        return true;
      },
      preTool: async (call) =>
        call.name === "blocked"
          ? { decision: "deny", reason: "not that one", context: [{ source: "hook:before", text: "looked at a" }] }
          : undefined,
      postTool: async (call) => ({ context: [{ source: "hook:after", text: `${call.id} settled` }] }),
      chat: async () => {
        asked += 1;
        return asked === 1 ? calls(["a", "blocked"], ["b", "fine"]) : { role: "assistant", content: "done" };
      },
      callTool: async (call) => {
        ran.push(call.id);
        return `${call.id}-out`;
      },
    },
    messages,
    new AbortController().signal,
    seen.emit,
  );
  assert.equal(outcome.reason, "completed");
  assert.deepEqual(ran, ["b"], "a refused call is never handed to a tool");
  assert.equal(classified, 1, "a refused call is never classified");
  assert.deepEqual(trace(seen.events), [
    "step:1",
    "call:blocked@a",
    "result:blocked@a:false",
    "call:fine@b",
    "result:fine@b:true",
    "step:2",
  ]);
  assert.deepEqual(messages.slice(1), [
    calls(["a", "blocked"], ["b", "fine"]),
    { role: "tool", tool_call_id: "a", name: "blocked", content: '{"error":"not that one"}' },
    { role: "user", name: "hook:before", content: "looked at a" },
    { role: "user", name: "hook:after", content: "a settled" },
    { role: "tool", tool_call_id: "b", name: "fine", content: "b-out" },
    { role: "user", name: "hook:after", content: "b settled" },
    { role: "assistant", content: "done" },
  ]);
}

{
  const messages: Message[] = [{ role: "user", content: "go" }];
  const settled: string[] = [];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 4,
      postTool: async (call, result) => {
        settled.push(`${call.id}:${result.ok}:${String(result.output)}`);
        return call.id === "b" ? { halt: true } : undefined;
      },
      chat: async () => {
        asked += 1;
        return calls(["a", "one"], ["b", "two"]);
      },
      callTool: async (call) => `${call.id}-out`,
    },
    messages,
    new AbortController().signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 1, text: "", reason: "stopped" });
  assert.deepEqual(settled, ["a:true:a-out", "b:true:b-out"], "the post-tool seam sees what the call settled as");
  assert.equal(asked, 1, "a halt ends the run instead of asking the model again");
}

{
  const messages: Message[] = [{ role: "user", content: "hello" }];
  const stops: Array<{ steps: number; stop_active: boolean }> = [];
  let asked = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 5,
      atStop: async (state) => {
        stops.push({ steps: state.step, stop_active: state.stopSteered });
        return { steer: "one more thing", context: [{ source: "hook:stop", text: `looked at ${state.step}` }] };
      },
      chat: async () => {
        asked += 1;
        return { role: "assistant", content: `answer ${asked}` };
      },
      callTool: async () => null,
    },
    messages,
    new AbortController().signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 2, text: "answer 2", reason: "completed" });
  assert.deepEqual(
    stops,
    [
      { steps: 1, stop_active: false },
      { steps: 2, stop_active: true },
    ],
    "the stop seam runs at every natural end and reports whether it has already steered",
  );
  assert.deepEqual(messages.slice(-3), [
    { role: "user", name: "hook:stop", content: "one more thing" },
    { role: "assistant", content: "answer 2" },
    { role: "user", name: "hook:stop", content: "looked at 2" },
  ]);
}

{
  let stops = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      atStop: async () => {
        stops += 1;
        return { steer: "again" };
      },
      chat: async () => calls(["c1", "again"]),
      callTool: async () => "ok",
    },
    [{ role: "user", content: "go" }],
    new AbortController().signal,
    silent,
  );
  assert.equal(outcome.reason, "max_steps");
  assert.equal(stops, 0, "a run that hit its step ceiling never reaches the stop seam");
}

{
  const controller = new AbortController();
  let stops = 0;
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 2,
      atStop: async () => {
        stops += 1;
        return undefined;
      },
      chat: async () => {
        controller.abort();
        return { role: "assistant", content: "half an answer" };
      },
      callTool: async () => null,
    },
    [{ role: "user", content: "go" }],
    controller.signal,
    silent,
  );
  assert.deepEqual(outcome, { steps: 1, text: "", reason: "aborted" });
  assert.equal(stops, 0, "a cancelled turn never reaches the stop seam");
}

console.log("agent loop ok: completed, max_steps, aborted, batching, ordering, seams, parsing");
