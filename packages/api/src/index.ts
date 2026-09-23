#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CallError, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import { readChat, type ChatReply } from "./messages.ts";
import { asOpenAITools, chat as openaiChat, streamChat, upstreamError, transportError, GATEWAY_ERROR, type Gateway } from "./openai.ts";
import { scriptedChat, type ScriptStep } from "./scripted.ts";
import { SseParser, applyDelta, createAccumulator, messageFromAccumulator } from "./sse.ts";

interface Settings {
  backend: "openai" | "scripted";
  model: string;
  key_env: string;
  retry_max: number;
  retry_backoff_ms: number;
  script: ScriptStep[];
}

let settings: Settings = {
  backend: "openai",
  model: "gpt-4o-mini",
  key_env: "OPENAI_API_KEY",
  retry_max: 2,
  retry_backoff_ms: 500,
  script: [],
};
let gateway: Gateway = { base_url: "https://api.openai.com/v1", api_key: "" };
let step = 0;

function keyFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "api_key");
}

function storedKey(): string {
  try {
    return readFileSync(keyFile(), "utf8").trim();
  } catch {
    return "";
  }
}

function storeKey(key: string): void {
  const path = keyFile();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key === "" ? "" : `${key}\n`, { mode: 0o600 });
}

function resolveKey(config: Record<string, unknown>, key_env: string): string {
  const configured = typeof config.api_key === "string" ? config.api_key.trim() : "";
  if (configured !== "") return configured;
  const fromEnv = (process.env[key_env] ?? "").trim();
  return fromEnv !== "" ? fromEnv : storedKey();
}

const SCRIPT_CHUNKS = 3;

/// Only a failure that could plausibly go away is retried: the gateway being
/// busy, broken or unreachable. A rejected key, a malformed request and a
/// cancelled turn are answers, not accidents.
const RETRYABLE = new Set<number>([GATEWAY_ERROR.rate_limit, GATEWAY_ERROR.server, GATEWAY_ERROR.transport]);

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && RETRYABLE.has(code);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/// The backoff doubles, so a gateway that is briefly busy is not hammered. The
/// caller decides whether another attempt is still honest, which is what keeps
/// a half-delivered stream from being replayed.
async function withRetry<T>(
  work: () => Promise<T>,
  again: () => boolean,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      attempt += 1;
      if (attempt > settings.retry_max || !retryable(error) || !again() || signal?.aborted === true) throw error;
      await pause(settings.retry_backoff_ms * 2 ** (attempt - 1), signal);
    }
  }
}

function requireKey(): void {
  if (settings.backend === "openai" && gateway.api_key === "") {
    throw new CallError(
      GATEWAY_ERROR.auth,
      `no API key: paste one in the web UI, or set ${settings.key_env}`,
    );
  }
}

function pieces(text: string): string[] {
  if (text === "") return [];
  const size = Math.ceil(text.length / SCRIPT_CHUNKS);
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

async function streamed(request: ReturnType<typeof readChat>, ctx: Call): Promise<unknown> {
  const stream = ctx.stream;
  if (!stream) throw new Error("streamed() without a stream");

  if (settings.backend === "scripted") {
    const reply = scriptedChat(settings.script, step++);
    const text = typeof reply.message.content === "string" ? reply.message.content : "";
    for (const piece of pieces(text)) {
      stream.push({ type: "delta", text: piece });
      await new Promise((resolve) => setImmediate(resolve));
    }
    stream.push({ type: "message", message: reply.message });
    return { backend: "scripted", model: request.model };
  }

  // Text already pushed cannot be taken back, so a stream that broke after the
  // first delta is reported as it happened rather than started over.
  let emitted = false;
  const reply = await withRetry(
    () =>
      streamChat(gateway, request, ctx.signal, (event) => {
        if (event.text) {
          emitted = true;
          stream.push({ type: "delta", text: event.text });
        }
        if (event.reasoning) stream.push({ type: "reasoning", text: event.reasoning });
      }),
    () => !emitted,
    ctx.signal,
  );
  stream.push({ type: "message", message: reply.message });
  return { backend: "openai", model: request.model };
}

export const definition: Definition = {
  provides: ["api"],
  configKeys: ["backend", "model", "base_url", "api_key", "api_key_env", "retry_max", "retry_backoff_ms", "script"],

  setup(wiring) {
    const config = wiring.config;
    const key_env = typeof config.api_key_env === "string" ? config.api_key_env : "OPENAI_API_KEY";
    settings = {
      backend: config.backend === "scripted" ? "scripted" : "openai",
      model: typeof config.model === "string" ? config.model : "gpt-4o-mini",
      key_env,
      retry_max:
        typeof config.retry_max === "number" && Number.isInteger(config.retry_max) && config.retry_max >= 0
          ? config.retry_max
          : 2,
      retry_backoff_ms:
        typeof config.retry_backoff_ms === "number" && config.retry_backoff_ms >= 0 ? config.retry_backoff_ms : 500,
      script: Array.isArray(config.script) ? (config.script as ScriptStep[]) : [],
    };
    step = 0;
    gateway = {
      base_url: typeof config.base_url === "string" ? config.base_url : "https://api.openai.com/v1",
      api_key: resolveKey(config, key_env),
    };
  },

  methods: {
    key() {
      return { has_key: gateway.api_key !== "" };
    },

    key_set(params) {
      const key = typeof params?.api_key === "string" ? params.api_key.trim() : "";
      gateway.api_key = key;
      storeKey(key);
      return { has_key: key !== "" };
    },

    async chat(params, ctx) {
      requireKey();
      const request = readChat(params, settings.model);
      if (ctx.stream) return await streamed(request, ctx);
      const reply: ChatReply =
        settings.backend === "scripted"
          ? scriptedChat(settings.script, step++)
          : await withRetry(() => openaiChat(gateway, request, ctx.signal), () => true, ctx.signal);
      return { backend: settings.backend, model: request.model, ...reply };
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const call = scriptedChat([{ tool: "shell", args: { command: "echo hi" } }], 0).message
      .tool_calls?.[0] as { function?: { name?: string; arguments?: string } } | undefined;
    if (call?.function?.name !== "shell") problems.push(`scripted tool call: ${JSON.stringify(call)}`);
    if (call?.function?.arguments !== '{"command":"echo hi"}') {
      problems.push(`scripted tool arguments: ${JSON.stringify(call?.function?.arguments)}`);
    }
    if (scriptedChat([{ text: "done" }], 0).message.content !== "done") problems.push("scripted text step is wrong");
    const wrapped = asOpenAITools([{ name: "shell", description: "d", input_schema: { type: "object" } }])[0] as {
      type?: string;
      function?: { name?: string; parameters?: unknown };
    };
    if (wrapped?.type !== "function" || wrapped.function?.name !== "shell") {
      problems.push(`tool spec not wrapped for the wire: ${JSON.stringify(wrapped)}`);
    }
    try {
      readChat({ messages: [] }, "m");
      problems.push("readChat accepted an empty message list");
    } catch {
    }
    const projected = readChat(
      {
        messages: [
          {
            role: "user",
            content: "hi",
            name: "skill-catalog",
            source: { kind: "skill-catalog", entries: [{ name: "s", description: "d" }] },
            capability: "tool.read",
          },
        ],
      },
      "m",
    ).messages[0] as unknown as Record<string, unknown>;
    if ("source" in projected) problems.push("readChat sent the local message source to the provider");
    if ("capability" in projected) problems.push("readChat sent a local field to the provider");
    if (projected.name !== "skill-catalog" || projected.content !== "hi") {
      problems.push(`readChat projected the message as ${JSON.stringify(projected)}`);
    }

    const parser = new SseParser();
    const half = parser.push('data: {"choices":[{"delta":{"content":"→');
    if (half.length !== 0) problems.push(`SSE parser flushed a half line: ${JSON.stringify(half)}`);
    const frames = parser.push('"}}]}\r\n\r\n: keep-alive\r\n\ndata: a\ndata: b\n\n');
    if (frames.length !== 2) problems.push(`SSE parser produced ${frames.length} frames, expected 2`);
    if (frames[0] !== '{"choices":[{"delta":{"content":"→"}}]}') {
      problems.push(`SSE parser glued the line wrong: ${JSON.stringify(frames[0])}`);
    }
    if (frames[1] !== "a\nb") problems.push(`SSE parser joined multi-line data as ${JSON.stringify(frames[1])}`);
    if (parser.push("data: [DONE]\n\n")[0] !== "[DONE]") problems.push("SSE parser lost the [DONE] marker");
    if (parser.end().length !== 0) problems.push("SSE parser invented a frame at the end of the stream");

    const acc = createAccumulator();
    const first = applyDelta(acc, { content: "hi", reasoning_content: "plan" });
    if (first.text !== "hi" || first.reasoning !== "plan") problems.push(`applyDelta emitted ${JSON.stringify(first)}`);
    applyDelta(acc, { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "shell", arguments: '{"comm' } }] });
    applyDelta(acc, { tool_calls: [{ index: 0, function: { arguments: 'and":"x"}' } }] });
    applyDelta(acc, { tool_calls: [{ index: 1, id: "c2", function: { name: "other", arguments: "{}" } }] });
    const message = messageFromAccumulator(acc);
    if (message.content !== "hi") problems.push(`accumulator content is ${JSON.stringify(message.content)}`);
    if (acc.reasoning !== "plan") problems.push(`accumulator reasoning is ${JSON.stringify(acc.reasoning)}`);
    const calls = (message.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    if (calls.length !== 2) problems.push(`accumulator kept ${calls.length} tool calls, expected 2`);
    if (calls[0]?.function?.arguments !== '{"command":"x"}') {
      problems.push(`accumulator glued arguments into ${JSON.stringify(calls[0]?.function?.arguments)}`);
    }
    if (calls[1]?.id !== "c2" || calls[1]?.function?.name !== "other") problems.push("accumulator lost the second tool call");
    if (messageFromAccumulator(createAccumulator()).content !== null) problems.push("an empty stream produced content");

    if (upstreamError(401, "nope").code !== GATEWAY_ERROR.auth) problems.push("401 is not mapped to the auth code");
    if (upstreamError(403, "nope").code !== GATEWAY_ERROR.auth) problems.push("403 is not mapped to the auth code");
    if (upstreamError(429, "slow").code !== GATEWAY_ERROR.rate_limit) problems.push("429 is not mapped to the rate limit code");
    if (upstreamError(503, "boom").code !== GATEWAY_ERROR.server) problems.push("503 is not mapped to the server code");
    if (transportError(new Error("boom")).code !== GATEWAY_ERROR.transport) problems.push("a network error is not mapped to transport");
    const aborted = transportError(Object.assign(new Error("stop"), { name: "AbortError" }));
    if (aborted.code !== -32013) problems.push(`an abort is mapped to ${aborted.code}, expected -32013`);

    const slow = settings.retry_backoff_ms;
    settings = { ...settings, retry_backoff_ms: 0 };
    let attempts = 0;
    const recovered = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new CallError(GATEWAY_ERROR.server, "upstream 503");
        return "ok";
      },
      () => true,
    );
    if (recovered !== "ok" || attempts !== 3) problems.push(`a busy gateway was tried ${attempts} times`);
    let hard = 0;
    try {
      await withRetry(
        async () => {
          hard += 1;
          throw new CallError(GATEWAY_ERROR.auth, "no");
        },
        () => true,
      );
      problems.push("an auth failure was retried");
    } catch {
    }
    if (hard !== 1) problems.push(`an auth failure was tried ${hard} times`);
    let exhausted = 0;
    try {
      await withRetry(
        async () => {
          exhausted += 1;
          throw new CallError(GATEWAY_ERROR.transport, "boom");
        },
        () => true,
      );
      problems.push("an unreachable gateway was never given up on");
    } catch {
    }
    if (exhausted !== settings.retry_max + 1) {
      problems.push(`a dead gateway was tried ${exhausted} times, expected ${settings.retry_max + 1}`);
    }
    let halfStreamed = 0;
    try {
      await withRetry(
        async () => {
          halfStreamed += 1;
          throw new CallError(GATEWAY_ERROR.transport, "broke mid-stream");
        },
        () => halfStreamed < 1,
      );
      problems.push("a stream that already delivered text was replayed");
    } catch {
    }
    if (halfStreamed !== 1) problems.push(`a half-delivered stream was tried ${halfStreamed} times`);
    settings = { ...settings, retry_backoff_ms: slow };

    try {
      requireKey();
      problems.push("a missing API key was not rejected");
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== GATEWAY_ERROR.auth) problems.push(`a missing API key is mapped to ${String(code)}`);
    }
    return problems;
  },
};

runPlugin(definition);
