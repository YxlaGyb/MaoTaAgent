
export class SseParser {
  private buffer = "";
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at < 0) break;
      const raw = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      this.line(raw.endsWith("\r") ? raw.slice(0, -1) : raw, out);
    }
    return out;
  }

  end(): string[] {
    const out: string[] = [];
    if (this.buffer !== "") this.line(this.buffer, out);
    this.buffer = "";
    this.flush(out);
    return out;
  }

  private line(raw: string, out: string[]): void {
    if (raw === "") {
      this.flush(out);
      return;
    }
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon < 0 ? raw : raw.slice(0, colon);
    if (field !== "data") return;
    const value = colon < 0 ? "" : raw.slice(colon + 1);
    this.data.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  private flush(out: string[]): void {
    if (this.data.length === 0) return;
    out.push(this.data.join("\n"));
    this.data = [];
  }
}

export interface ToolCallChunk {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface Delta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: ToolCallChunk[];
}

export interface Accumulator {
  content: string;
  reasoning: string;
  tool_calls: ToolCallChunk[];
}

export interface StreamMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCallChunk[];
}

export function createAccumulator(): Accumulator {
  return { content: "", reasoning: "", tool_calls: [] };
}

export function applyDelta(acc: Accumulator, delta: Delta): { text: string; reasoning: string } {
  const text = typeof delta?.content === "string" ? delta.content : "";
  acc.content += text;

  const thinking =
    typeof delta?.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta?.reasoning === "string"
        ? delta.reasoning
        : "";
  acc.reasoning += thinking;

  for (const [at, call] of (Array.isArray(delta?.tool_calls) ? delta.tool_calls : []).entries()) {
    const slot = typeof call.index === "number" ? call.index : at;
    while (acc.tool_calls.length <= slot) acc.tool_calls.push({ function: {} });
    const target = acc.tool_calls[slot]!;
    if (typeof call.id === "string") target.id = call.id;
    if (typeof call.type === "string") target.type = call.type;
    if (typeof call.function?.name === "string") {
      target.function = { ...target.function, name: call.function.name, arguments: target.function?.arguments };
    }
    if (typeof call.function?.arguments === "string") {
      target.function = { ...target.function, arguments: (target.function?.arguments ?? "") + call.function.arguments };
    }
  }

  return { text, reasoning: thinking };
}

export function messageFromAccumulator(acc: Accumulator): StreamMessage {
  const calls = acc.tool_calls.filter((call) => call.function?.name || call.id);
  return {
    role: "assistant",
    content: acc.content === "" ? null : acc.content,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
}
