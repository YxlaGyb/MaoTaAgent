import type { Message } from "./session.ts";
import type { ToolSpec } from "./tools.ts";

export type LoopEvent =
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; output: unknown }
  | { type: "tick" }
  | { type: "done"; steps: number; text: string };

export interface ChatDelta {
  text?: string;
  reasoning?: string;
}

export interface LoopDeps {
  chat(
    messages: Message[],
    tools: ToolSpec[],
    signal: AbortSignal,
    emit: (delta: ChatDelta) => void,
  ): Promise<Message>;
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
    const message = await deps.chat(messages, deps.tools, signal, (delta) => {
      if (typeof delta.text === "string" && delta.text !== "") emit({ type: "text", text: delta.text });
      if (typeof delta.reasoning === "string" && delta.reasoning !== "") emit({ type: "reasoning", text: delta.reasoning });
    });
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
