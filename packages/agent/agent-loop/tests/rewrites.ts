/// What a seam can rewrite. A decision is not advice: what the pre-tool seam
/// says the arguments are is what the tool is handed, what is classified and
/// what the result is written against, and what the post-tool seam says the
/// answer is is what the model reads.

import assert from "node:assert/strict";

import { runLoop, type Message } from "../src/index.ts";
import { calls, silent } from "./support.ts";

export async function runRewrites(): Promise<void> {
  {
    const seen: unknown[] = [];
    const classified: unknown[] = [];
    const messages: Message[] = [{ role: "user", content: "go" }];
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async (step) => (step.step === 1 ? calls(["c1", "write"]) : { role: "assistant", content: "done" }),
        callTool: async (call) => {
          seen.push(call.args);
          return "raw answer";
        },
        classify: async (call) => {
          classified.push(call.args);
          return false;
        },
        preTool: async () => ({ args: { file_path: "C:\\fixed.txt" } }),
        postTool: async () => ({ output: "trimmed answer" }),
      },
      messages,
      new AbortController().signal,
      silent,
    );
    assert.equal(outcome.reason, "completed");
    assert.deepEqual(seen, [{ file_path: "C:\\fixed.txt" }], "the tool ran with the arguments it was given");
    assert.deepEqual(classified, [{ file_path: "C:\\fixed.txt" }], "classification saw the same arguments");
    const result = messages.find((message) => message.role === "tool");
    assert.equal(result?.content, "trimmed answer", "the model read what the seam chose to write back");
  }

  {
    const messages: Message[] = [{ role: "user", content: "go" }];
    await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async (step) => (step.step === 1 ? calls(["c1", "echo"]) : { role: "assistant", content: "done" }),
        callTool: async () => "plain",
        preTool: async () => {
          throw new Error("no opinion today");
        },
        postTool: async () => {
          throw new Error("nor here");
        },
      },
      messages,
      new AbortController().signal,
      silent,
    );
    assert.equal(messages.find((message) => message.role === "tool")?.content, "plain");
  }
}
