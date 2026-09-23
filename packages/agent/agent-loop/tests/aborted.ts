/// A run whose signal is already aborted never asks the model anything, and one
/// that is aborted while a tool is running stops after that tool settles.

import assert from "node:assert/strict";

import { runLoop, type Message } from "../src/index.ts";
import { calls, silent } from "./support.ts";

export async function runAborted(): Promise<void> {
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
}
