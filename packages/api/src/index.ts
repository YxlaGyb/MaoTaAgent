#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { CallError, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import { failureOf, kindOfCode, isTransient, parseRetryAfter, type ModelFailure } from "@maota/api-protocol";
import { readChat, type ChatReply, type SessionRef } from "./messages.ts";
import { asOpenAITools, chat as openaiChat, streamChat, upstreamError, transportError, GATEWAY_ERROR, type Gateway } from "./openai.ts";
import { DEFAULT_RETRY, policyFor, readRetry, retryDecision, type RetryTables } from "./retry.ts";
import { scriptedChat, type ScriptStep } from "./scripted.ts";
import { SseParser, applyDelta, createAccumulator, messageFromAccumulator } from "./sse.ts";

interface Settings {
  backend: "openai" | "scripted";
  model: string;
  key_env: string;
  stream_idle_timeout_ms: number;
  script: ScriptStep[];
  retry: RetryTables;
}

let settings: Settings = {
  backend: "openai",
  model: "gpt-4o-mini",
  key_env: "OPENAI_API_KEY",
  stream_idle_timeout_ms: 120_000,
  script: [],
  retry: readRetry(undefined),
};
let gateway: Gateway = { base_url: "https://api.openai.com/v1", api_key: "", idle_timeout_ms: 120_000 };
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

/// A model-request failure is the one thing this plugin is allowed to announce
/// as a terminal chunk rather than a rejection, because the consumer can no
/// longer act on it and a recovery policy must see it as data. Everything else
/// keeps the documented shape: only a failure this dialect named travels that
/// way, so a defect in this process still throws and is never mistaken for a
/// provider that answered badly.
function isWireFailure(error: unknown): boolean {
  return error instanceof CallError && kindOfCode(error.code) !== "unknown";
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

/// One attempt: the scripted stand-in or the real stream, read into the chunks a
/// front end watches. It announces nothing about its own ending, because whether
/// a failure is worth another attempt is not this function's to decide.
async function attemptStreamed(
  request: ReturnType<typeof readChat>,
  index: number,
  ctx: Call,
  speak: (event: { text?: string; reasoning?: string }) => void,
): Promise<ChatReply> {
  if (settings.backend === "scripted") {
    const planned = settings.script[index];
    if (planned !== undefined && typeof planned.text === "string") {
      for (const piece of pieces(planned.text)) {
        speak({ text: piece });
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return scriptedChat(settings.script, index);
  }
  return await streamChat(gateway, request, ctx.signal, speak);
}

/// A replacement is written down before it is waited out: the document keeps
/// the reason and the delay, so a process that dies during a backoff still says
/// which attempt was replaced and why. A deployment without a session still
/// replaces the request; what is lost is only the trail, so a failed write is
/// reported and never turned into a failure of the call itself.
async function writeDown(
  ctx: Call,
  where: SessionRef | undefined,
  event: { phase: "scheduled" | "started"; attempt: number; delay_ms: number; failure_kind: string; reason: string },
): Promise<void> {
  if (where === undefined || ctx.capabilities.session === undefined) return;
  try {
    await ctx.channel.call(
      "session",
      "append_event",
      { id: where.id, cwd: where.cwd, event: { ...event, step: where.step } },
      { signal: ctx.signal },
    );
  } catch (error) {
    ctx.channel.log("warn", "api: a replacement could not be written down", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/// The stream a consumer reads, and the one place a request is replaced. The
/// adapter that talks to the provider is the only side that knows what an
/// endpoint's answer means, so the whole of the transient decision is made here
/// rather than by the loop: the loop is told about a replacement as a chunk,
/// which is what lets it take back what the replaced attempt already showed, and
/// the replacement is written into the session before the wait begins so a
/// process that dies during a backoff leaves the attempt behind it on disk.
async function streamed(request: ReturnType<typeof readChat>, ctx: Call): Promise<unknown> {
  const stream = ctx.stream;
  if (!stream) throw new Error("streamed() without a stream");
  let index = step++;
  const backend = settings.backend;
  const model = request.model;
  const where = request.session;
  const policy = policyFor(settings.retry, backend, model);
  let retries = 0;
  let emitted = false;
  const speak = (event: { text?: string; reasoning?: string }): void => {
    if (event.text) {
      emitted = true;
      stream.push({ type: "delta", text: event.text });
    }
    if (event.reasoning) {
      emitted = true;
      stream.push({ type: "reasoning", text: event.reasoning });
    }
  };
  const replace = async (
    attempt: number,
    failure: ModelFailure,
    delay_ms: number,
    reason: string,
  ): Promise<void> => {
    await writeDown(ctx, where, {
      phase: "scheduled",
      attempt,
      delay_ms,
      failure_kind: failure.kind,
      reason,
    });
    stream.push({ type: "retry", phase: "scheduled", attempt, delay_ms, failure, reason });
  };
  for (;;) {
    try {
      const reply = await attemptStreamed(request, index, ctx, speak);
      stream.push({ type: "message", message: reply.message });
      return { backend, model };
    } catch (error) {
      if (!isWireFailure(error)) throw error;
      const failure = failureOf(error);
      const decision = retryDecision(policy, failure, { retries, emitted });
      if (!decision.retry) {
        // Why a request was not replaced is the one sentence an operator reads
        // afterwards, and the failure has already been handed to the consumer,
        // so this is where the reason is written down.
        ctx.channel.log("warn", `api: the model request was not replaced: ${decision.reason}`, {
          kind: failure.kind,
        });
        stream.push({ type: "error", failure });
        return { backend, model, failed: true };
      }
      retries += 1;
      await replace(retries, failure, decision.delay_ms, decision.reason);
      try {
        await sleep(decision.delay_ms, undefined, { signal: ctx.signal });
      } catch {
        // A cancelled wait is a cancelled call, and the turn is the place that
        // says so: no failure is announced, so an attempt the person ended never
        // reads as an endpoint that answered badly.
        return { backend, model, failed: true };
      }
      // A scripted deployment lists its attempts in order, so the next attempt
      // reads the next entry: the script is the timeline, not the call.
      index += 1;
      emitted = false;
      await writeDown(ctx, where, {
        phase: "started",
        attempt: retries,
        delay_ms: decision.delay_ms,
        failure_kind: failure.kind,
        reason: decision.reason,
      });
      stream.push({ type: "retry", phase: "started", attempt: retries, delay_ms: decision.delay_ms });
    }
  }
}

export const definition: Definition = {
  provides: ["api"],
  // A replacement is durable evidence, and the session is where durable
  // evidence lives; a deployment without one still replaces the request.
  requires: [{ capability: "session", optional: true }],
  configKeys: [
    "backend",
    "model",
    "base_url",
    "api_key",
    "api_key_env",
    "stream_idle_timeout_ms",
    "script",
    "retry",
  ],

  setup(wiring) {
    const config = wiring.config;
    const key_env = typeof config.api_key_env === "string" ? config.api_key_env : "OPENAI_API_KEY";
    const idle_timeout_ms =
      typeof config.stream_idle_timeout_ms === "number" && config.stream_idle_timeout_ms >= 0
        ? config.stream_idle_timeout_ms
        : 120_000;
    settings = {
      backend: config.backend === "scripted" ? "scripted" : "openai",
      model: typeof config.model === "string" ? config.model : "gpt-4o-mini",
      key_env,
      stream_idle_timeout_ms: idle_timeout_ms,
      script: Array.isArray(config.script) ? (config.script as ScriptStep[]) : [],
      retry: readRetry(config.retry),
    };
    step = 0;
    gateway = {
      base_url: typeof config.base_url === "string" ? config.base_url : "https://api.openai.com/v1",
      api_key: resolveKey(config, key_env),
      idle_timeout_ms,
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
          : await openaiChat(gateway, request, ctx.signal);
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
    if (upstreamError(400, '{"error":{"code":"context_length_exceeded"}}').code !== GATEWAY_ERROR.context_window) {
      problems.push("a context overflow is not mapped to the context window code");
    }
    if (upstreamError(429, '{"error":{"code":"insufficient_quota"}}').code !== GATEWAY_ERROR.quota) {
      problems.push("an exhausted quota is not mapped to the quota code");
    }
    const extra = upstreamError(429, "slow", { retry_after_ms: 3000, request_id: "req_1" }).data as {
      retry_after_ms?: number;
      request_id?: string;
    };
    if (extra?.retry_after_ms !== 3000 || extra?.request_id !== "req_1") {
      problems.push(`the wire facts were dropped: ${JSON.stringify(extra)}`);
    }
    if (transportError(new Error("boom")).code !== GATEWAY_ERROR.transport) problems.push("a network error is not mapped to transport");
    const aborted = transportError(Object.assign(new Error("stop"), { name: "AbortError" }));
    if (aborted.code !== -32013) problems.push(`an abort is mapped to ${aborted.code}, expected -32013`);
    if (transportError(new Error("stop"), true).code !== GATEWAY_ERROR.timeout) {
      problems.push("an expired watchdog is not mapped to the timeout code");
    }

    const kinds: Array<[number, string]> = [
      [GATEWAY_ERROR.auth, "auth"],
      [GATEWAY_ERROR.rate_limit, "rate_limit"],
      [GATEWAY_ERROR.server, "server"],
      [GATEWAY_ERROR.transport, "transport"],
      [GATEWAY_ERROR.parse, "protocol"],
      [GATEWAY_ERROR.empty, "empty_response"],
      [GATEWAY_ERROR.context_window, "context_window"],
      [GATEWAY_ERROR.timeout, "timeout"],
      [GATEWAY_ERROR.quota, "quota"],
      [-32013, "aborted"],
      [-99999, "unknown"],
    ];
    for (const [code, kind] of kinds) {
      if (kindOfCode(code) !== kind) problems.push(`code ${code} is kind ${kindOfCode(code)}, expected ${kind}`);
    }
    const failure = failureOf(upstreamError(503, "boom", { status: 503, request_id: "req_2" }));
    if (failure.kind !== "server" || failure.status !== 503 || failure.request_id !== "req_2") {
      problems.push(`failureOf lost something: ${JSON.stringify(failure)}`);
    }
    if (!isTransient("rate_limit") || isTransient("auth") || isTransient("context_window")) {
      problems.push("the transient kinds are not the accidental ones");
    }
    if (parseRetryAfter("2") !== 2000) problems.push("Retry-After seconds were not read");
    if (parseRetryAfter(null) !== undefined || parseRetryAfter("nonsense") !== undefined) {
      problems.push("a Retry-After nobody can act on was treated as a delay");
    }
    const at = Date.UTC(2024, 0, 1);
    if (parseRetryAfter("Mon, 01 Jan 2024 00:00:05 GMT", at) !== 5000) {
      problems.push("an HTTP-date Retry-After was not read");
    }

    const tables = readRetry({
      max_retries: 3,
      initial_delay_ms: 10,
      providers: { openai: { max_retries: 9 }, "scripted/model-x": { max_retries: 4 }, "": { max_retries: 1 } },
    });
    if (policyFor(tables, "openai", "gpt-4o-mini").max_retries !== 9) {
      problems.push("a provider policy did not override the shared one");
    }
    if (policyFor(tables, "scripted", "model-x").max_retries !== 4) {
      problems.push("an address policy did not win over a backend policy");
    }
    if (policyFor(tables, "other", "m").max_retries !== 3) {
      problems.push("an address nobody configured did not take the shared policy");
    }
    if (policyFor(tables, "openai", "gpt-4o-mini").initial_delay_ms !== 10) {
      problems.push("a provider policy did not inherit what it left blank");
    }
    if (policyFor(readRetry(undefined), "openai", "gpt-4o-mini").max_retries !== DEFAULT_RETRY.max_retries) {
      problems.push("a deployment with no retry table did not take the defaults");
    }

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
