/// The OpenAI-compatible wire adapter: the one place that decides what a
/// gateway's answer means in this build's vocabulary. A status, a body and a set
/// of headers become a canonical code plus the facts the wire actually stated,
/// so nothing downstream ever reads a message to find out what happened.

import { CallError } from "@maota/plugin-kit";
import { ABORTED, GATEWAY_ERROR, parseRetryAfter, type FailureFacts } from "@maota/api-protocol";
import { IdleWatchdog } from "./idle.ts";
import type { ChatReply, ChatRequest } from "./messages.ts";
import { SseParser, applyDelta, createAccumulator, messageFromAccumulator, type Delta, type StreamMessage } from "./sse.ts";

export { GATEWAY_ERROR };

export interface Gateway {
  base_url: string;
  api_key: string;
  /// How long a single wait may stay silent before the request is given up on.
  /// Zero means the adapter never gives up, which is only right for a backend
  /// nothing can be waiting on.
  idle_timeout_ms: number;
}

const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "openai-request-id"];

/// Signals that a rejection is about the size of the request rather than about
/// the request itself. Every vendor words them differently, so the only honest
/// way to read them is by the marker the vendor documents.
const CONTEXT_SIGNALS = [
  "context_length_exceeded",
  "maximum context length",
  "context length",
  "too many tokens",
  "reduce the length of the messages",
];

const QUOTA_SIGNALS = ["insufficient_quota", "exceeded your current quota", "billing"];

function mentions(body: string, signals: readonly string[]): boolean {
  const text = body.toLowerCase();
  return signals.some((signal) => text.includes(signal));
}

/// The facts a response states about itself. A `Retry-After` a provider sent is
/// carried through, because the wire knows the wait better than any backoff.
export function gatewayFacts(response: Response): FailureFacts {
  let request_id: string | undefined;
  for (const header of REQUEST_ID_HEADERS) {
    const value = response.headers.get(header);
    if (value !== null && value.trim() !== "") {
      request_id = value.trim();
      break;
    }
  }
  const retry_after_ms = parseRetryAfter(response.headers.get("retry-after"));
  return {
    status: response.status,
    ...(retry_after_ms === undefined ? {} : { retry_after_ms }),
    ...(request_id === undefined ? {} : { request_id }),
  };
}

export function upstreamError(status: number, body: string, facts: FailureFacts = {}): CallError {
  const detail = body.slice(0, 500);
  const data: FailureFacts = { ...facts, status };
  if (status === 401 || status === 403) {
    return new CallError(GATEWAY_ERROR.auth, `gateway rejected the credentials (${status}): ${detail}`, data);
  }
  if (mentions(body, CONTEXT_SIGNALS)) {
    return new CallError(
      GATEWAY_ERROR.context_window,
      `the request does not fit the model's context window (${status}): ${detail}`,
      data,
    );
  }
  if (status === 429) {
    return mentions(body, QUOTA_SIGNALS)
      ? new CallError(GATEWAY_ERROR.quota, `the account has no room left on this plan (429): ${detail}`, data)
      : new CallError(GATEWAY_ERROR.rate_limit, `gateway rate limit (429): ${detail}`, data);
  }
  return new CallError(GATEWAY_ERROR.server, `upstream ${status}: ${detail}`, data);
}

/// A broken connection, a cancellation and a watchdog that expired all arrive
/// here looking alike, so the one distinction that matters is passed in rather
/// than guessed at from an error name.
export function transportError(error: unknown, timedOut = false): CallError {
  if (error instanceof CallError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (timedOut) return new CallError(GATEWAY_ERROR.timeout, "the gateway went quiet mid-stream");
  if (error instanceof Error && error.name === "AbortError") {
    return new CallError(ABORTED, "cancelled by the caller");
  }
  return new CallError(GATEWAY_ERROR.transport, `the gateway connection broke: ${message}`);
}

/// The caller's cancellation and this adapter's deadline, joined into the one
/// signal the request is made with.
function wire(signal: AbortSignal | undefined, idle: IdleWatchdog): AbortSignal {
  return signal === undefined ? idle.signal : AbortSignal.any([signal, idle.signal]);
}

async function send(
  gateway: Gateway,
  request: ChatRequest,
  signal: AbortSignal | undefined,
  stream: boolean,
): Promise<{ response: Response; idle: IdleWatchdog }> {
  const idle = new IdleWatchdog(gateway.idle_timeout_ms);
  const url = `${gateway.base_url.replace(/\/+$/, "")}/chat/completions`;
  try {
    const response = await idle.guard(() =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${gateway.api_key}` },
        body: body(request, stream),
        signal: wire(signal, idle),
      }),
    );
    return { response, idle };
  } catch (error) {
    idle.stop();
    throw transportError(error, idle.timedOut);
  }
}

/// A rejection is read with both halves of the answer: the status says what
/// kind of refusal it is, and the body says which of the several refusals that
/// status covers.
async function failed(response: Response): Promise<CallError> {
  const text = await response.text().catch(() => "");
  return upstreamError(response.status, text, gatewayFacts(response));
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
  const { response, idle } = await send(gateway, request, signal, false);
  if (!response.ok) {
    idle.stop();
    throw await failed(response);
  }
  let payload: { choices?: Array<{ message?: unknown }>; usage?: unknown };
  try {
    payload = (await idle.guard(() => response.json())) as typeof payload;
  } catch (error) {
    throw transportError(error, idle.timedOut);
  } finally {
    idle.stop();
  }
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
  const { response, idle } = await send(gateway, request, signal, true);
  if (!response.ok) {
    idle.stop();
    throw await failed(response);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    idle.stop();
    throw new CallError(GATEWAY_ERROR.transport, "the gateway answered with no body to stream");
  }

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
      const next = await idle.guard(() => reader.read());
      if (next.done) break;
      for (const payload of parser.push(decoder.decode(next.value, { stream: true }))) take(payload);
      if (done) break;
    }
    if (!done) for (const payload of parser.end()) take(payload);
  } catch (error) {
    throw transportError(error, idle.timedOut);
  } finally {
    idle.stop();
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
