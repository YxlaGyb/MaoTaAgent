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

/// The wire message is a whitelist: a field the harness keeps for itself, such
/// as the source of a note it injected, is not something a model provider was
/// ever meant to see, and one that leaks here would travel back on the next
/// turn as if the model had written it.
function project(raw: unknown): Message | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.role !== "string" || input.role === "") return null;
  const message: Message = { role: input.role };
  if (typeof input.content === "string" || input.content === null) message.content = input.content;
  if (Array.isArray(input.tool_calls)) message.tool_calls = input.tool_calls;
  if (typeof input.tool_call_id === "string") message.tool_call_id = input.tool_call_id;
  if (typeof input.name === "string") message.name = input.name;
  return message;
}

export function readChat(params: unknown, defaultModel: string): ChatRequest {
  const input = (params ?? {}) as Record<string, unknown>;
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new CallError(-32602, "messages must be a non-empty array");
  }
  const projected: Message[] = [];
  for (const raw of messages) {
    const message = project(raw);
    if (message === null) throw new CallError(-32602, "every message needs a role");
    projected.push(message);
  }
  return {
    model: typeof input.model === "string" ? input.model : defaultModel,
    messages: projected,
    tools: Array.isArray(input.tools) && input.tools.length > 0 ? input.tools : undefined,
    temperature: typeof input.temperature === "number" ? input.temperature : undefined,
  };
}
