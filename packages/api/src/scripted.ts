// 离线后端: 按脚本一步步回。用来跑通整条链路（测试、无网环境、脱机演示），
// 或者把"模型"钉死来量 loop 的行为。
import { CallError } from "../../plugin-kit/src/index.ts";
import type { ChatReply } from "./messages.ts";

export interface ScriptStep {
  text?: string;
  tool?: string;
  args?: unknown;
}

export function scriptedChat(script: readonly ScriptStep[], index: number): ChatReply {
  const step = script[index];
  if (!step) return { message: { role: "assistant", content: "(the script ran out)" } };
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