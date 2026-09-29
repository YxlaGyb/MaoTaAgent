/// The router's retry policy. It reads only the normalized failure, so every
/// adapter shares one accidental-failure vocabulary and one budget.

import { isTransient, type FailureKind, type ModelFailure } from "@maota/model-protocol";

export interface RetryPolicy {
  max_retries: number;
  retryable_kinds: FailureKind[];
  initial_delay_ms: number;
  max_delay_ms: number;
  jitter_ratio: number;
  respect_retry_after: boolean;
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

export const ACCIDENTAL_KINDS: readonly FailureKind[] = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
];

export interface RetryTables {
  every: RetryPolicy;
  providers: Map<string, RetryPolicy>;
}

export type RetryDecision =
  | { retry: true; delay_ms: number; reason: string }
  | { retry: false; reason: string };

function count(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function ratio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function policy(value: unknown, fallback: RetryPolicy): RetryPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const configured = Array.isArray(raw.retryable_kinds)
    ? raw.retryable_kinds.filter((kind): kind is FailureKind => ACCIDENTAL_KINDS.includes(kind as FailureKind))
    : fallback.retryable_kinds;
  return {
    max_retries: count(raw.max_retries, fallback.max_retries),
    retryable_kinds: configured,
    initial_delay_ms: count(raw.initial_delay_ms, fallback.initial_delay_ms),
    max_delay_ms: count(raw.max_delay_ms, fallback.max_delay_ms),
    jitter_ratio: ratio(raw.jitter_ratio, fallback.jitter_ratio),
    respect_retry_after: raw.respect_retry_after !== false,
    allow_partial_retry: raw.allow_partial_retry !== false,
  };
}

export function readRetry(value: unknown): RetryTables {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { every: DEFAULT_RETRY, providers: new Map() };
  }
  const raw = value as Record<string, unknown>;
  const every = policy(raw, DEFAULT_RETRY);
  const providers = new Map<string, RetryPolicy>();
  if (raw.providers !== null && typeof raw.providers === "object" && !Array.isArray(raw.providers)) {
    for (const [name, item] of Object.entries(raw.providers as Record<string, unknown>)) {
      if (name !== "") providers.set(name, policy(item, every));
    }
  }
  return { every, providers };
}

export function policyFor(tables: RetryTables, adapter: string, model: string): RetryPolicy {
  return tables.providers.get(`${adapter}/${model}`) ?? tables.providers.get(adapter) ?? tables.every;
}

export function backoffDelay(policy: RetryPolicy, attempt: number, roll: number): number {
  const base = Math.min(policy.initial_delay_ms * 2 ** attempt, policy.max_delay_ms);
  const spread = (roll * 2 - 1) * base * policy.jitter_ratio;
  return Math.max(0, Math.round(base + spread));
}

export function retryDecision(
  policy: RetryPolicy,
  failure: ModelFailure,
  attempt: { retries: number; emitted: boolean },
  roll = Math.random(),
): RetryDecision {
  if (!isTransient(failure.kind)) return { retry: false, reason: `\`${failure.kind}\` is an answer, not an accident` };
  if (!policy.retryable_kinds.includes(failure.kind)) {
    return { retry: false, reason: `\`${failure.kind}\` is not on this policy's retryable list` };
  }
  if (attempt.retries >= policy.max_retries) return { retry: false, reason: `the attempt budget of ${policy.max_retries} is spent` };
  if (attempt.emitted && !policy.allow_partial_retry) {
    return { retry: false, reason: "this policy does not replace an answer that had already been seen" };
  }
  const named = policy.respect_retry_after ? failure.retry_after_ms : undefined;
  if (named !== undefined && named > policy.max_delay_ms) {
    return { retry: false, reason: `the provider asked for ${named}ms, longer than this policy will wait` };
  }
  return { retry: true, delay_ms: named ?? backoffDelay(policy, attempt.retries, roll), reason: `\`${failure.kind}\` is worth another attempt` };
}
