// 一轮对话的引擎: 问模型 → 跑它要的工具 → 再问，直到它不再要工具（或撞上限）。
// 这里不认识 shell，也不认识 HTTP —— 工具和模型都是能力 id，由调用方接进来。
import type { Message } from "./session.ts";
import type { ToolSpec } from "./tools.ts";

export type LoopEvent =
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; output: unknown }
  | { type: "tick" }
  | { type: "done"; steps: number; text: string };

export interface LoopDeps {
  chat(messages: Message[], tools: ToolSpec[], signal: AbortSignal): Promise<Message>;
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<unknown>;
  tools: ToolSpec[];
  max_steps: number;
}

export interface LoopOutcome {
  steps: number;
  text: string;
}

export async function runLoop(
  deps: LoopDeps,
  messages: Message[],
  signal: AbortSignal,
  emit: (event: LoopEvent) => void,
): Promise<LoopOutcome> {
  for (let step = 1; step <= deps.max_steps; step += 1) {
    if (signal.aborted) return { steps: step - 1, text: "" };
    emit({ type: "step", step });
    const message = await deps.chat(messages, deps.tools, signal);
    messages.push(message);

    const calls = toolCalls(message);
    if (calls.length === 0) {
      return { steps: step, text: typeof message.content === "string" ? message.content : "" };
    }

    for (const call of calls) {
      emit({ type: "tool_call", tool: call.name, args: call.args });
      try {
        const output = await deps.callTool(call.name, call.args, signal);
        emit({ type: "tool_result", tool: call.name, ok: true, output });
        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: asText(output) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // 工具炸了不是这一轮的终点: 把失败原样告诉模型，让它决定下一步。
        emit({ type: "tool_result", tool: call.name, ok: false, output: reason });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify({ error: reason }),
        });
      }
    }
  }
  return { steps: deps.max_steps, text: "" };
}

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

function toolCalls(message: Message): ToolCall[] {
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return raw.flatMap((entry, index) => {
    const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | undefined;
    const name = String(call?.function?.name ?? "");
    if (name === "") return [];
    return [{ id: String(call?.id ?? `call_${index}`), name, args: parseArgs(call?.function?.arguments) }];
  });
}

/** 参数是模型给的 JSON 字符串（OpenAI 的约定）。坏 JSON 原样往下传，让工具自己说不。 */
function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}