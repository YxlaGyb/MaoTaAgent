/// The hook seams around a turn: a pre-tool refusal never reaches a tool, a
/// post-tool halt ends the run, and the stop seam runs at every natural end but
/// never when the run was cut short by its ceiling or a cancellation.

import assert from "node:assert/strict";

import { runLoop, type Message } from "../src/index.ts";
import { calls, recorder, silent, trace } from "./support.ts";

export async function runSeams(): Promise<void> {
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
}
