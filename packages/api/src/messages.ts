import { CallError } from "@maota/plugin-kit";

export interface Message {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools: unknown[] | undefined;
  temperature: number | undefined;
}

export interface ChatReply {
  message: Message;
  usage?: unknown;
}

export function readChat(params: unknown, defaultModel: string): ChatRequest {
  const input = (params ?? {}) as Record<string, unknown>;
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new CallError(-32602, "messages must be a non-empty array");
  }
  for (const message of messages) {
    if (typeof (message as Message | undefined)?.role !== "string") {
      throw new CallError(-32602, "every message needs a role");
    }
  }
  return {
    model: typeof input.model === "string" ? input.model : defaultModel,
    messages: messages as Message[],
    tools: Array.isArray(input.tools) && input.tools.length > 0 ? input.tools : undefined,
    temperature: typeof input.temperature === "number" ? input.temperature : undefined,
  };
}