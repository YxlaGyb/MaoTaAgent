/// A run that keeps asking for another tool call until it hits its step
/// ceiling, and stops there with the reason the outcome names.

import assert from "node:assert/strict";

import { runLoop } from "../src/index.ts";
import { calls, recorder, trace } from "./support.ts";

export async function runMaxSteps(): Promise<void> {
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
