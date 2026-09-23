/// The recovery path: an attempt that fails is announced and taken back before
/// the next one starts, a retried step does not spend the step budget, a policy
/// that gives up ends the run with the failure attached, and a policy that
/// breaks ends it too rather than being swallowed into a silent hang.

import assert from "node:assert/strict";

import { ModelFailureError, runLoop, type LoopEvent, type Message } from "../src/index.ts";
import { recorder, silent, trace } from "./support.ts";

function transient(message: string): ModelFailureError {
  return new ModelFailureError({ message, code: -32051, kind: "rate_limit", status: 429, retry_after_ms: 1000 });
}

export async function runRecovery(): Promise<void> {
  {
    const seen = recorder();
    const failures: string[] = [];
    const deltas: string[] = [];
    let asked = 0;
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 3,
        chat: async (step) => {
          asked += 1;
          if (asked === 1) {
            step.delta({ text: "half an ans" });
            throw transient("slow down");
          }
          step.delta({ text: "the answer" });
          return { role: "assistant", content: "the answer" };
        },
        callTool: async () => null,
        onModelError: async (failure) => {
          failures.push(failure.kind);
          return { action: "retry", delay_ms: 0 };
        },
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      (event) => {
        if (event.type === "text") deltas.push(event.text);
        seen.emit(event);
      },
    );
    assert.deepEqual(outcome, { steps: 1, text: "the answer", reason: "completed" });
    assert.deepEqual(failures, ["rate_limit"]);
    assert.deepEqual(deltas, ["half an ans", "the answer"]);
    assert.deepEqual(
      seen.events.filter((event) => event.type === "retract"),
      [{ type: "retract", reason: "rate_limit" }],
    );
    assert.deepEqual(trace(seen.events), ["step:1", "step:1"]);
  }

  {
    const seen = recorder();
    let asked = 0;
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          asked += 1;
          throw transient("still busy");
        },
        callTool: async () => null,
        onModelError: async () => (asked < 2 ? { action: "retry", delay_ms: 0 } : { action: "give_up" }),
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      seen.emit,
    );
    assert.deepEqual(outcome, {
      steps: 1,
      text: "",
      reason: "model_error",
      failure: { message: "still busy", code: -32051, kind: "rate_limit", status: 429, retry_after_ms: 1000 },
    });
    assert.deepEqual(trace(seen.events), ["step:1", "step:1"]);
  }

  {
    const messages: Message[] = [{ role: "user", content: "hi" }];
    let asked = 0;
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          asked += 1;
          if (asked === 1) throw transient("busy");
          return { role: "assistant", content: "after the note" };
        },
        callTool: async () => null,
        onModelError: async () => ({ action: "retry", delay_ms: 0, steer: "the conversation was folded away" }),
      },
      messages,
      new AbortController().signal,
      silent,
    );
    assert.deepEqual(outcome, { steps: 1, text: "after the note", reason: "completed" });
    assert.deepEqual(messages, [
      { role: "user", content: "hi" },
      { role: "user", name: "recovery:model", content: "the conversation was folded away" },
      { role: "assistant", content: "after the note" },
    ]);
  }

  {
    const seen = recorder();
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          throw transient("busy");
        },
        callTool: async () => null,
        onModelError: async () => {
          throw new Error("the policy itself is broken");
        },
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      seen.emit,
    );
    assert.equal(outcome.reason, "model_error");
    assert.equal(outcome.failure?.kind, "rate_limit");
  }

  {
    const seen = recorder();
    let asked = 0;
    const controller = new AbortController();
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          asked += 1;
          throw transient("busy");
        },
        callTool: async () => null,
        onModelError: async () => {
          controller.abort();
          return { action: "retry", delay_ms: 0 };
        },
      },
      [{ role: "user", content: "hi" }],
      controller.signal,
      (_event: LoopEvent) => seen.emit(_event),
    );
    assert.equal(asked, 1, "an aborted turn never retries");
    assert.deepEqual(outcome, { steps: 1, text: "", reason: "aborted" });
  }

  {
    const seen = recorder();
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 1,
        chat: async () => {
          throw transient("busy");
        },
        callTool: async () => null,
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      seen.emit,
    );
    assert.equal(outcome.reason, "model_error");
    assert.deepEqual(trace(seen.events), ["step:1"]);
  }
}
