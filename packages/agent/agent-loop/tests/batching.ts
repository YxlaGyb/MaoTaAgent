/// How tool calls are grouped into batches: calls that may run together share a
/// batch up to `max_parallel`, a call the classifier refuses runs alone, and a
/// classifier that is missing, throws, or answers something else leaves the run
/// serialised instead of guessing.

import assert from "node:assert/strict";

import { runLoop, type Message } from "../src/index.ts";
import { batched, calls, recorder, silent, trace } from "./support.ts";

export async function runBatching(): Promise<void> {
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
      messages
        .filter((message) => message.role === "tool")
        .map((message) => `${message.tool_call_id}:${message.content}`),
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
    [
      "a throwing classifier",
      async () => {
        throw new Error("nope");
      },
    ],
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
}

export async function runBatchShapes(): Promise<void> {
  assert.deepEqual(
    batched(["parallel", "parallel", "blocked", "parallel", "parallel"], 4),
    [["c0", "c1"], ["c2"], ["c3", "c4"]],
    "a call that runs alone ends the group around it, and its neighbours still batch up to max_parallel",
  );
  assert.deepEqual(batched(["serial", "serial"], 8), [["c0"], ["c1"]], "a serial call runs alone");
  assert.deepEqual(batched(["parallel", "parallel", "parallel"], 2), [["c0", "c1"], ["c2"]]);
  assert.deepEqual(batched([], 2), []);
}
