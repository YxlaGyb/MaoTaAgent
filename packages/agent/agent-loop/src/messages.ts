export interface Message {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

/// Text a seam injects, tagged with where it came from so the message it
/// becomes can say so.
export interface SourcedText {
  source: string;
  text: string;
}

export interface ToolHostArg {
  name: string;
  source: string;
}

export interface ToolSpec {
  name: string;
  description?: string;
  input_schema?: unknown;
  capability?: string;
  host_args?: ToolHostArg[];
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

/// Injected text becomes a user message whose `name` is the source the seam
/// gave, so a reader of the stored session can tell it from what a person
/// typed.
export function sourcedMessages(notes: readonly SourcedText[]): Message[] {
  return notes
    .filter((note) => note.text.trim() !== "")
    .map((note) => ({ role: "user", name: note.source, content: note.text }));
}
