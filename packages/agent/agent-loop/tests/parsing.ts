/// How a reply and a tool call are parsed: a reply that names no tool call ends
/// the turn, and the shapes read out of a message are the ones the loop promises.

import assert from "node:assert/strict";

import { asText, parseArgs, runLoop, toolCalls, type Message } from "../src/index.ts";
import { recorder, trace } from "./support.ts";

export async function runParsing(): Promise<void> {
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
}
