import { CallError } from "../../plugin-kit/src/index.ts";
import type { ChatReply, ChatRequest } from "./messages.ts";
import { SseParser, applyDelta, createAccumulator, messageFromAccumulator, type Delta, type StreamMessage } from "./sse.ts";

export interface Gateway {
  base_url: string;
  api_key: string;
}

export const GATEWAY_ERROR = {
  auth: -32050,
  rate_limit: -32051,
  server: -32052,
  transport: -32053,
  parse: -32054,
  empty: -32055,
} as const;

export function upstreamError(status: number, body: string): CallError {
  const detail = body.slice(0, 500);
  if (status === 401 || status === 403) {
    return new CallError(GATEWAY_ERROR.auth, `gateway rejected the credentials (${status}): ${detail}`);
  }
  if (status === 429) return new CallError(GATEWAY_ERROR.rate_limit, `gateway rate limit (429): ${detail}`);
  return new CallError(GATEWAY_ERROR.server, `upstream ${status}: ${detail}`);
}

export function transportError(error: unknown): CallError {
  if (error instanceof CallError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return new CallError(-32013, "cancelled by the caller");
  }
  return new CallError(GATEWAY_ERROR.transport, `the gateway connection broke: ${message}`);
}

function body(request: ChatRequest, stream: boolean): string {
  return JSON.stringify({
    model: request.model,
    messages: request.messages,
    ...(request.tools ? { tools: asOpenAITools(request.tools) } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(stream ? { stream: true } : {}),
  });
}

export function asOpenAITools(tools: readonly unknown[]): unknown[] {
  return tools.map((tool) => {
    const spec = tool as { type?: unknown; name?: unknown; description?: unknown; input_schema?: unknown; parameters?: unknown };
    if (spec?.type === "function") return tool;
    return {
      type: "function",
      function: {
        name: spec?.name,
        description: spec?.description,
        parameters: spec?.parameters ?? spec?.input_schema ?? { type: "object", properties: {} },
      },
    };
  });
}

export async function chat(gateway: Gateway, request: ChatRequest, signal?: AbortSignal): Promise<ChatReply> {
  const url = `${gateway.base_url.replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gateway.api_key}` },
      body: body(request, false),
      signal: signal ?? null,
    });
  } catch (error) {
    throw transportError(error);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw upstreamError(response.status, text);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: unknown }>; usage?: unknown };
  const message = payload.choices?.[0]?.message;
  if (!message || typeof message !== "object") {
    throw new CallError(-32603, "upstream reply has no choices[0].message");
  }
  return { message: message as ChatReply["message"], usage: payload.usage };
}


export async function streamChat(
  gateway: Gateway,
  request: ChatRequest,
  signal: AbortSignal | undefined,
  emit: (event: { text?: string; reasoning?: string }) => void,
): Promise<ChatReply> {
  const url = `${gateway.base_url.replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gateway.api_key}` },
      body: body(request, true),
      signal: signal ?? null,
    });
  } catch (error) {
    throw transportError(error);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw upstreamError(response.status, text);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CallError(GATEWAY_ERROR.transport, "the gateway answered with no body to stream");

  const decoder = new TextDecoder();
  const parser = new SseParser();
  const acc = createAccumulator();
  let usage: unknown;
  let done = false;

  const take = (payload: string): void => {
    if (payload === "[DONE]") {
      done = true;
      return;
    }
    let frame: { choices?: Array<{ delta?: Delta }>; usage?: unknown; error?: { message?: string } };
    try {
      frame = JSON.parse(payload) as typeof frame;
    } catch {
      throw new CallError(GATEWAY_ERROR.parse, `the gateway sent a chunk that is not JSON: ${payload.slice(0, 200)}`);
    }
    if (frame.error) throw new CallError(GATEWAY_ERROR.server, `upstream error mid-stream: ${frame.error.message ?? payload.slice(0, 200)}`);
    if (frame.usage !== undefined) usage = frame.usage;
    const delta = frame.choices?.[0]?.delta;
    if (!delta) return;
    const step = applyDelta(acc, delta);
    if (step.text !== "" || step.reasoning !== "") emit(step);
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      for (const payload of parser.push(decoder.decode(next.value, { stream: true }))) take(payload);
      if (done) break;
    }
    if (!done) for (const payload of parser.end()) take(payload);
  } catch (error) {
    throw transportError(error);
  }

  if (!done) {
    throw new CallError(
      GATEWAY_ERROR.transport,
      `the stream ended before [DONE] after ${acc.content.length + acc.reasoning.length} chars`,
    );
  }

  const message = messageFromAccumulator(acc) as ChatReply["message"] & StreamMessage;
  if (message.content === null && !message.tool_calls) {
    throw new CallError(GATEWAY_ERROR.empty, "the gateway finished the stream without any content");
  }
  return { message, usage };
}
