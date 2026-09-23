/// The retry policy and the retry ring it drives, tested as the two pieces they
/// are: the decision is pure, so its whole matrix is checked without arranging
/// anything, and the ring is driven over the scripted backend so no socket is
/// ever opened. The plugin shell around them is what `--check` covers.

import assert from "node:assert/strict";

import { readModelFailure, type ModelFailure } from "@maota/api-protocol";
import type { Call, Wiring } from "@maota/plugin-kit";

import { definition } from "../src/index.ts";
import {
  ACCIDENTAL_KINDS,
  DEFAULT_RETRY,
  backoffDelay,
  policyFor,
  readRetry,
  retryDecision,
  type RetryDecision,
  type RetryPolicy,
} from "../src/retry.ts";

const policy: RetryPolicy = DEFAULT_RETRY;
const server: ModelFailure = { message: "upstream 503", code: -32052, kind: "server" };
const rate: ModelFailure = { message: "slow down", code: -32051, kind: "rate_limit", retry_after_ms: 3000 };
const overflow: ModelFailure = { message: "too long", code: -32056, kind: "context_window" };
const auth: ModelFailure = { message: "no key", code: -32050, kind: "auth" };
const fresh = { retries: 0, emitted: false };

/// The delay of a decision that has one, so a refused replacement is not read as
/// a zero-length wait.
function delayOf(decision: RetryDecision): number {
  return decision.retry ? decision.delay_ms : -1;
}

assert.deepEqual([...ACCIDENTAL_KINDS].sort(), ["empty_response", "rate_limit", "server", "timeout", "transport"]);

{
  assert.deepEqual(retryDecision(policy, server, fresh, 0.5), {
    retry: true,
    delay_ms: 500,
    reason: "`server` is worth another attempt",
  });
  assert.deepEqual(retryDecision(policy, server, { retries: 1, emitted: false }, 0.5), {
    retry: true,
    delay_ms: 1000,
    reason: "`server` is worth another attempt",
  });
  assert.deepEqual(retryDecision(policy, server, { retries: 2, emitted: false }, 0.5), {
    retry: false,
    reason: "the attempt budget of 2 is spent",
  });
  assert.equal(retryDecision(policy, auth, fresh, 0.5).reason, "`auth` is an answer, not an accident");
  assert.equal(
    retryDecision(policy, overflow, fresh, 0.5).reason,
    "`context_window` is an answer, not an accident",
    "a request that no longer fits is not the adapter's to answer",
  );
  assert.equal(
    retryDecision(policy, server, { retries: 0, emitted: true }, 0.5).retry,
    true,
    "a visible answer is replaced when the policy allows it",
  );
  assert.equal(
    retryDecision({ ...policy, allow_partial_retry: false }, server, { retries: 0, emitted: true }, 0.5).reason,
    "this policy does not replace an answer that had already been seen",
  );
  assert.equal(retryDecision({ ...policy, retryable_kinds: ["server"] }, rate, fresh, 0.5).retry, false);
}

{
  assert.equal(backoffDelay(policy, 0, 0), 375);
  assert.equal(backoffDelay(policy, 0, 1), 625);
  assert.equal(backoffDelay(policy, 0, 0.5), 500);
  assert.equal(backoffDelay({ ...policy, max_delay_ms: 100 }, 9, 1), 125, "the ceiling is not jittered");
}

{
  assert.equal(delayOf(retryDecision(policy, rate, fresh, 0)), 3000, "a named delay is not jittered");
  assert.notEqual(delayOf(retryDecision({ ...policy, respect_retry_after: false }, rate, fresh, 0.5)), 3000);
  assert.equal(retryDecision(policy, { ...rate, retry_after_ms: 60_000 }, fresh, 0.5).retry, false);
}

{
  const configured = readRetry({
    max_retries: 4,
    retryable_kinds: ["server", "nonsense", 7],
    jitter_ratio: 2,
    initial_delay_ms: -1,
    max_delay_ms: -5,
    respect_retry_after: "no",
    allow_partial_retry: false,
    providers: { openai: { max_retries: 9 }, "scripted/mine": { allow_partial_retry: true }, "": { max_retries: 1 } },
  });
  assert.equal(configured.every.max_retries, 4);
  assert.deepEqual(configured.every.retryable_kinds, ["server"]);
  assert.equal(configured.every.jitter_ratio, DEFAULT_RETRY.jitter_ratio);
  assert.equal(configured.every.initial_delay_ms, DEFAULT_RETRY.initial_delay_ms);
  assert.equal(configured.every.max_delay_ms, DEFAULT_RETRY.max_delay_ms);
  assert.equal(configured.every.respect_retry_after, DEFAULT_RETRY.respect_retry_after);
  assert.equal(configured.every.allow_partial_retry, false);
  assert.equal(policyFor(configured, "openai", "gpt-4o-mini").max_retries, 9);
  assert.equal(policyFor(configured, "scripted", "mine").allow_partial_retry, true);
  assert.equal(policyFor(configured, "scripted", "mine").max_retries, 4, "a narrow policy inherits the shared one");
  assert.equal(policyFor(configured, "other", "m").max_retries, 4);
  assert.deepEqual(readRetry(undefined).every, DEFAULT_RETRY);
}

{
  assert.equal(readModelFailure({ message: "x", code: 1, kind: "nonsense" }), null);
  assert.equal(readModelFailure(server)?.kind, "server");
}

/// A call whose stream is a list, so the order a consumer sees is the order the
/// plugin pushed. Nothing here reads the wire.
function sink(): { seen: Record<string, any>[]; ctx: Call } {
  const seen: Record<string, any>[] = [];
  const ctx = {
    channel: { log: () => {}, call: async () => ({}), publish: async () => {} },
    capabilities: {},
    capability: "api",
    method: "chat",
    caller: "agent.loop",
    config: {},
    signal: new AbortController().signal,
    stream: { push: (event: unknown) => seen.push(event as Record<string, any>) },
  } as unknown as Call;
  return { seen, ctx };
}

function configure(config: Record<string, unknown>): void {
  definition.setup?.({ channel: undefined, config, capabilities: {} } as unknown as Wiring);
}

async function chat(model: string | undefined, ctx: Call): Promise<any> {
  const params = { messages: [{ role: "user", content: "hi" }], ...(model === undefined ? {} : { model }) };
  return await definition.methods.chat?.(params, ctx);
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0 },
    script: [{ text: "half", fail: { status: 503 } }, { text: "again" }],
  });
  const { seen, ctx } = sink();
  const reply = await chat(undefined, ctx);
  const retries = seen.filter((event) => event.type === "retry");
  assert.equal(retries.length, 2, "a replacement is announced twice, scheduled and started");
  assert.equal(retries[0]?.phase, "scheduled");
  assert.equal(retries[0]?.attempt, 1);
  assert.equal(retries[0]?.delay_ms, 0);
  assert.equal(retries[0]?.reason, "`server` is worth another attempt");
  assert.equal(retries[0]?.failure?.kind, "server");
  assert.equal(retries[1]?.phase, "started");
  assert.deepEqual(
    seen.map((event) => event.type),
    ["delta", "delta", "retry", "retry", "delta", "delta", "delta", "message"],
    "a consumer reads the replaced attempt, then the schedule, then the replacement",
  );
  assert.deepEqual(seen.at(-1)?.message, { role: "assistant", content: "again" });
  assert.equal(reply?.failed, undefined);
  assert.equal(reply?.model, "gpt-4o-mini");
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0, max_retries: 1 },
    script: [{ text: "a", fail: { status: 503 } }, { text: "b", fail: { status: 503 } }, { text: "c" }],
  });
  const { seen, ctx } = sink();
  const reply = await chat(undefined, ctx);
  const retries = seen.filter((event) => event.type === "retry");
  assert.equal(retries.length, 2, "the budget stops the ring after one replacement");
  assert.equal(seen.filter((event) => event.type === "error").length, 1);
  assert.equal(seen.at(-1)?.failure?.kind, "server");
  assert.equal(reply?.failed, true);
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0, allow_partial_retry: false },
    script: [{ text: "half", fail: { status: 503 } }, { text: "again" }],
  });
  const { seen, ctx } = sink();
  const reply = await chat(undefined, ctx);
  assert.equal(seen.filter((event) => event.type === "retry").length, 0, "a seen answer is never replaced silently");
  assert.equal(seen.filter((event) => event.type === "error").length, 1);
  assert.equal(reply?.failed, true);
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0 },
    script: [{ fail: { status: 401, body: "no key" } }, { text: "never" }],
  });
  const { seen, ctx } = sink();
  const refused = await chat(undefined, ctx);
  assert.equal(seen.filter((event) => event.type === "retry").length, 0, "an answer is not an accident");
  assert.equal(seen.at(-1)?.failure?.kind, "auth");
  assert.equal(refused?.failed, true);
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0 },
    script: [{ fail: { status: 429, retry_after_ms: 20 } }, { text: "after the named wait" }],
  });
  const { seen, ctx } = sink();
  const named = await chat(undefined, ctx);
  const schedule = seen.find((event) => event.type === "retry" && event.phase === "scheduled");
  assert.equal(schedule?.delay_ms, 20, "the provider's own number wins");
  assert.equal(schedule?.failure?.kind, "rate_limit");
  assert.equal(named?.failed, undefined);
}

{
  configure({
    backend: "scripted",
    retry: { initial_delay_ms: 0, providers: { "scripted/gpt-4o-mini": { max_retries: 0 } } },
    script: [{ fail: { status: 503 } }, { fail: { status: 503 } }, { text: "other" }],
  });
  const { seen, ctx } = sink();
  const mine = await chat("gpt-4o-mini", ctx);
  assert.equal(mine?.failed, true, "the address that may not retry does not");
  assert.equal(seen.filter((event) => event.type === "retry").length, 0);

  const { seen: open, ctx: opening } = sink();
  const other = await chat("other-model", opening);
  assert.equal(other?.failed, undefined, "another address keeps its own budget");
  assert.equal(open.filter((event) => event.type === "retry").length, 2);
}

console.log("api ok: retry policy, per-address tables, backoff, Retry-After, the replacement ring");
