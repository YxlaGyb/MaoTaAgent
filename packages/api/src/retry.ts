/// What to do about a request that failed, decided from the failure alone and
/// from the address it was sent to. This file is pure: no clock, no channel, no
/// network, so the whole matrix of failures and budgets can be checked without
/// arranging one. The randomness a jitter needs is passed in rather than drawn,
/// which is what keeps a decision reproducible in a test.
///
/// The policy lives beside the adapter because everything it reads is a
/// property of the endpoint: a 429, a `Retry-After` and the budget behind them
/// belong to the provider, not to the conversation that happened to be sent to
/// it. A deployment may therefore write one policy for every address it talks to
/// and a different one for the address that is known to be slow.

import { isTransient, type FailureKind, type ModelFailure } from "@maota/api-protocol";

export interface RetryPolicy {
  /// How many replacement attempts one request chain may spend in total, so a
  /// gateway that keeps failing cannot keep a turn alive.
  max_retries: number;
  /// The accidental kinds this policy is willing to replace. A kind left out
  /// always ends the turn, which is how a deployment narrows recovery without
  /// turning it off.
  retryable_kinds: FailureKind[];
  initial_delay_ms: number;
  max_delay_ms: number;
  /// The fraction of the delay that is drawn at random, so several callers that
  /// failed together do not come back together.
  jitter_ratio: number;
  /// A provider that names a wait knows better than any backoff, so its number
  /// wins when it is one this policy will actually wait for.
  respect_retry_after: boolean;
  /// Whether an attempt the consumer has already seen may be replaced. Off, any
  /// visible output makes the failure final, because showing two answers to one
  /// question is worse than showing none.
  allow_partial_retry: boolean;
}

export const DEFAULT_RETRY: RetryPolicy = {
  max_retries: 2,
  retryable_kinds: ["rate_limit", "server", "transport", "timeout", "empty_response"],
  initial_delay_ms: 500,
  max_delay_ms: 30_000,
  jitter_ratio: 0.25,
  respect_retry_after: true,
  allow_partial_retry: true,
};

/// The accidental kinds a policy may name, so a config cannot ask for a kind
/// that would never be an accident in the first place.
export const ACCIDENTAL_KINDS: readonly FailureKind[] = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
];

/// The policies one deployment wrote, resolved into the two questions an
/// address is looked up with: what every address does, and what this one does.
export interface RetryTables {
  every: RetryPolicy;
  /// Keyed by `backend` and by `backend/model`, most specific first.
  providers: Map<string, RetryPolicy>;
}

/// What one request chain has already spent, and whether the attempt it is
/// being asked about had already shown the consumer something.
export interface Attempt {
  retries: number;
  emitted: boolean;
}

/// A replacement, with the wait it will keep and the sentence that says why. A
/// refusal carries the same sentence, because a call that was not replaced is
/// worth as much to a reader as one that was.
export type RetryDecision =
  | { retry: true; delay_ms: number; reason: string }
  | { retry: false; reason: string };

function stop(reason: string): RetryDecision {
  return { retry: false, reason };
}

/// The delay between two attempts: a doubling base with enough randomness to
/// break up a herd.
export function backoffDelay(policy: RetryPolicy, attempt: number, roll: number): number {
  const base = Math.min(policy.initial_delay_ms * 2 ** attempt, policy.max_delay_ms);
  const spread = (roll * 2 - 1) * base * policy.jitter_ratio;
  return Math.max(0, Math.round(base + spread));
}

export function retryDecision(
  policy: RetryPolicy,
  failure: ModelFailure,
  attempt: Attempt,
  roll = Math.random(),
): RetryDecision {
  if (!isTransient(failure.kind)) return stop(`\`${failure.kind}\` is an answer, not an accident`);
  if (!policy.retryable_kinds.includes(failure.kind)) {
    return stop(`\`${failure.kind}\` is not on this policy's retryable list`);
  }
  if (attempt.retries >= policy.max_retries) {
    return stop(`the attempt budget of ${policy.max_retries} is spent`);
  }
  if (attempt.emitted && !policy.allow_partial_retry) {
    return stop("this policy does not replace an answer that had already been seen");
  }
  const named = policy.respect_retry_after ? failure.retry_after_ms : undefined;
  if (named !== undefined && named > policy.max_delay_ms) {
    return stop(`the provider asked for ${named}ms, longer than this policy will wait`);
  }
  return {
    retry: true,
    delay_ms: named ?? backoffDelay(policy, attempt.retries, roll),
    reason: `\`${failure.kind}\` is worth another attempt`,
  };
}

function count(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Number.isInteger(value) ? value : Math.round(value);
}

function ratio(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function table(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/// Configuration is read once, at start, in one place: a policy that is half
/// applied is worse than one that is plainly the default, so every field falls
/// back on its own rather than taking the whole config down.
export function readPolicy(config: Record<string, unknown>, fallback: RetryPolicy): RetryPolicy {
  const kinds = Array.isArray(config.retryable_kinds)
    ? config.retryable_kinds.filter(
        (kind): kind is FailureKind =>
          typeof kind === "string" && (ACCIDENTAL_KINDS as readonly string[]).includes(kind),
      )
    : fallback.retryable_kinds;
  return {
    max_retries: count(config.max_retries, fallback.max_retries),
    retryable_kinds: kinds,
    initial_delay_ms: count(config.initial_delay_ms, fallback.initial_delay_ms),
    max_delay_ms: count(config.max_delay_ms, fallback.max_delay_ms),
    jitter_ratio: ratio(config.jitter_ratio, fallback.jitter_ratio),
    respect_retry_after: flag(config.respect_retry_after, fallback.respect_retry_after),
    allow_partial_retry: flag(config.allow_partial_retry, fallback.allow_partial_retry),
  };
}

/// The `retry` table a deployment wrote: the fields directly on it are the
/// policy for every address, and `providers` narrows one address at a time. A
/// provider entry starts from the shared policy rather than from the defaults,
/// so a deployment that only wants a longer budget writes only that.
export function readRetry(value: unknown): RetryTables {
  const configured = table(value);
  const every = readPolicy(configured, DEFAULT_RETRY);
  const providers = new Map<string, RetryPolicy>();
  const listed = table(configured.providers);
  for (const [address, entry] of Object.entries(listed)) {
    const name = address.trim();
    if (name !== "") providers.set(name, readPolicy(table(entry), every));
  }
  return { every, providers };
}

export function policyFor(tables: RetryTables, backend: string, model: string): RetryPolicy {
  return tables.providers.get(`${backend}/${model}`) ?? tables.providers.get(backend) ?? tables.every;
}
