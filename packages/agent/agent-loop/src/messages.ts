export interface Message {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description?: string;
  input_schema?: unknown;
  capability?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export function toolCalls(message: Message): ToolCall[] {
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return raw.flatMap((entry, index) => {
    const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | undefined;
    const name = String(call?.function?.name ?? "");
    if (name === "") return [];
    return [{ id: String(call?.id ?? `call_${index}`), name, args: parseArgs(call?.function?.arguments) }];
  });
}

export function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}
