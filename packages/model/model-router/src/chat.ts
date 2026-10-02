import { setTimeout as sleep } from "node:timers/promises";

import { CallError, type Call } from "@maota/plugin-kit";
import { failureOf, readModelFailure, type ModelRequest, type Message, type ResolvedModel } from "@maota/model-protocol";
import { catalogSettings, keyFor } from "./catalog.ts";
import { adapterRoute } from "./registry.ts";
import { policyFor, retryDecision, type RetryTables } from "./retry.ts";

export function adapterCapability(adapter: string): string {
  return `model.adapter.${adapter}`;
}

function requireAdapter(adapter: string): string {
  const capability = adapterCapability(adapter);
  if (adapterRoute(adapter) === undefined) throw new CallError(-32602, `unknown adapter: ${adapter}`);
  return capability;
}

async function attempt(ctx: Call, request: ModelRequest, resolved: ResolvedModel): Promise<void> {
  const stream = await ctx.channel.stream(
    requireAdapter(resolved.provider.adapter),
    "chat",
    adapterParams(request, resolved),
    { signal: ctx.signal },
  );
  for await (const chunk of stream) ctx.stream?.push(chunk);
}

function adapterParams(request: ModelRequest, resolved: ResolvedModel): Record<string, unknown> {
  return {
    ...request,
    route: resolved.route,
    provider: resolved.provider,
    model: resolved.model,
    api_key: keyFor(resolved.provider),
    idle_timeout_ms: catalogSettings().idle_timeout_ms,
  };
}

export async function completeModel(ctx: Call, request: ModelRequest, resolved: ResolvedModel): Promise<{ message: Message; usage?: unknown }> {
  const stream = await ctx.channel.stream(requireAdapter(resolved.provider.adapter), "chat", adapterParams(request, resolved), { signal: ctx.signal });
  let message: Message | undefined;
  let usage: unknown;
  for await (const chunk of stream) {
    const event = chunk as { type?: unknown; message?: unknown; usage?: unknown; failure?: unknown } | null;
    if (event?.type === "message" && event.message !== null && typeof event.message === "object") {
      message = event.message as Message;
      usage = event.usage;
    }
    if (event?.type === "error") {
      const failure = readModelFailure(event.failure);
      if (failure !== null) throw failureOf({ code: failure.code, message: failure.message, data: failure });
    }
  }
  if (message === undefined) throw new CallError(-32603, "model router returned no message");
  return { message, ...(usage === undefined ? {} : { usage }) };
}

async function writeRetry(ctx: Call, request: ModelRequest, event: {
  phase: "scheduled" | "started";
  attempt: number;
  delay_ms: number;
  failure_kind: string;
  reason: string;
}): Promise<void> {
  if (request.session === undefined || ctx.capabilities.session === undefined) return;
  try {
    await ctx.channel.call(
      "session",
      "append_event",
      { id: request.session.id, cwd: request.session.cwd, event: { ...event, step: request.session.step } },
      { signal: ctx.signal },
    );
  } catch {
    ctx.channel.log("warn", "model router: a retry could not be written down");
  }
}

export async function streamModel(
  ctx: Call,
  request: ModelRequest,
  resolved: ResolvedModel,
  retry: RetryTables,
): Promise<Record<string, unknown>> {
  const policy = policyFor(retry, resolved.provider.adapter, resolved.model.model);
  let retries = 0;
  let emitted = false;
  for (;;) {
    try {
      await attempt(ctx, request, resolved);
      return { adapter: resolved.provider.adapter, model: resolved.model.model, failed: false };
    } catch (error) {
      if (ctx.signal.aborted) return { adapter: resolved.provider.adapter, model: resolved.model.model, failed: true };
      const failure = failureOf(error);
      const decision = retryDecision(policy, failure, { retries, emitted });
      if (!decision.retry) {
        ctx.stream?.push({ type: "error", failure });
        return { adapter: resolved.provider.adapter, model: resolved.model.model, failed: true };
      }
      retries += 1;
      await writeRetry(ctx, request, { phase: "scheduled", attempt: retries, delay_ms: decision.delay_ms, failure_kind: failure.kind, reason: decision.reason });
      ctx.stream?.push({ type: "retry", phase: "scheduled", attempt: retries, delay_ms: decision.delay_ms, failure_kind: failure.kind, reason: decision.reason });
      await sleep(decision.delay_ms, undefined, { signal: ctx.signal });
      await writeRetry(ctx, request, { phase: "started", attempt: retries, delay_ms: decision.delay_ms, failure_kind: failure.kind, reason: decision.reason });
      ctx.stream?.push({ type: "retry", phase: "started", attempt: retries, delay_ms: decision.delay_ms });
      emitted = false;
    }
  }
}
