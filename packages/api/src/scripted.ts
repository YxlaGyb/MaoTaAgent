import { CallError } from "@maota/plugin-kit";
import { upstreamError } from "./openai.ts";
import type { ChatReply } from "./messages.ts";

/// A scripted step that fails, so the whole recovery path can be exercised
/// without a network: the failure is built by the same classifier a real
/// response goes through, which is what makes the script an honest stand-in.
export interface ScriptFailure {
  status?: number;
  body?: string;
  retry_after_ms?: number;
}

export interface ScriptStep {
  text?: string;
  tool?: string;
  args?: unknown;
  fail?: ScriptFailure;
}

export function scriptedChat(script: readonly ScriptStep[], index: number): ChatReply {
  const step = script[index];
  if (!step) return { message: { role: "assistant", content: "(the script ran out)" } };
  if (step.fail !== undefined) {
    const status = step.fail.status ?? 503;
    const facts =
      step.fail.retry_after_ms === undefined
        ? { status }
        : { status, retry_after_ms: step.fail.retry_after_ms };
    throw upstreamError(status, step.fail.body ?? "", facts);
  }
  if (typeof step.text === "string") {
    return { message: { role: "assistant", content: step.text } };
  }
  if (typeof step.tool === "string") {
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_${index}`,
            type: "function",
            function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
          },
        ],
      },
    };
  }
  throw new CallError(-32602, `script step ${index} has neither text nor tool`);
}