/// The completed path: a turn that streams deltas and answers, a turn whose
/// tool calls run in the order they were asked for, and a turn where one tool
/// throws and the run still recovers.

import assert from "node:assert/strict";

import { runLoop, type Message } from "../src/index.ts";
import { calls, recorder, silent, trace } from "./support.ts";

export async function runCompleted(): Promise<void> {
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
}
