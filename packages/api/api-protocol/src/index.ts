/// The dialect of one gateway call: the canonical codes a provider-neutral
/// failure carries, the kind vocabulary a recovery policy is written in, and
/// the shape a failure takes when it crosses a process boundary. A numeric code
/// is the wire truth an adapter reports; a kind is what a deployment configures
/// its policy with, so a config never has to name a number.
///
/// @module @maota/api-protocol

/// One code per way a gateway call can end without an answer. Nothing here is
/// transient or otherwise by itself: an adapter reports the fact, and only a
/// policy decides what to do about it.
export const GATEWAY_ERROR = {
  auth: -32050,
  rate_limit: -32051,
  server: -32052,
  transport: -32053,
  parse: -32054,
  empty: -32055,
  context_window: -32056,
  timeout: -32057,
  quota: -32058,
} as const;

/// The code a call cancelled by its own caller carries. It lives beside the
/// gateway codes because that is the only place a caller sees it.
export const ABORTED = -32013;

export const FAILURE_KINDS = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
  "context_window",
  "auth",
  "quota",
  "request",
  "protocol",
  "aborted",
  "unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

/// The kinds that describe an accident rather than an answer. A policy may
/// still refuse to retry one of these; none of the others is ever an accident.
export const TRANSIENT_KINDS: readonly FailureKind[] = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
];

const BY_CODE = new Map<number, FailureKind>([
  [GATEWAY_ERROR.auth, "auth"],
  [GATEWAY_ERROR.rate_limit, "rate_limit"],
  [GATEWAY_ERROR.server, "server"],
  [GATEWAY_ERROR.transport, "transport"],
  [GATEWAY_ERROR.parse, "protocol"],
  [GATEWAY_ERROR.empty, "empty_response"],
  [GATEWAY_ERROR.context_window, "context_window"],
  [GATEWAY_ERROR.timeout, "timeout"],
  [GATEWAY_ERROR.quota, "quota"],
  [ABORTED, "aborted"],
  [-32602, "request"],
]);

export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && (FAILURE_KINDS as readonly string[]).includes(value);
}

export function isTransient(kind: FailureKind): boolean {
  return TRANSIENT_KINDS.includes(kind);
}

/// A code this build does not know is not a guess at a kind: it is a failure
/// nobody has a policy for, which is exactly what `unknown` says.
export function kindOfCode(code: number): FailureKind {
  return BY_CODE.get(code) ?? "unknown";
}

/// What an adapter reports about a failed call. Every field but `message`,
/// `code` and `kind` is optional because only the wire knows whether it has
/// them; a policy that needs one must handle its absence.
export interface ModelFailure {
  message: string;
  code: number;
  kind: FailureKind;
  status?: number;
  retry_after_ms?: number;
  request_id?: string;
}

/// The facts a response carries about its own failure, read off the wire and
/// carried on the error so no recovery policy ever parses error text.
export interface FailureFacts {
  status?: number;
  retry_after_ms?: number;
  request_id?: string;
}

export function readFacts(value: unknown): FailureFacts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(typeof input.status === "number" && Number.isFinite(input.status) ? { status: input.status } : {}),
    ...(typeof input.retry_after_ms === "number" && Number.isFinite(input.retry_after_ms) && input.retry_after_ms > 0
      ? { retry_after_ms: input.retry_after_ms }
      : {}),
    ...(typeof input.request_id === "string" && input.request_id !== "" ? { request_id: input.request_id } : {}),
  };
}

/// `Retry-After` is seconds or an HTTP date, and a provider that named a delay
/// is trusted only as far as the delay is a number this build can act on.
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds * 1000);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  const delay = at - now;
  return delay > 0 ? delay : undefined;
}

/// The failure an error already is: a code this dialect knows keeps its kind,
/// and anything else is `unknown` rather than a guess.
export function failureOf(error: unknown): ModelFailure {
  const found = (error ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const code = typeof found.code === "number" && Number.isFinite(found.code) ? found.code : -32603;
  return {
    message: typeof found.message === "string" && found.message !== "" ? found.message : String(error),
    code,
    kind: kindOfCode(code),
    ...readFacts(found.data),
  };
}

/// A failure as it crosses a process boundary: every field is checked, because
/// the reader is a process that did not build the payload.
export function readModelFailure(value: unknown): ModelFailure | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.message !== "string" || input.message === "") return null;
  if (typeof input.code !== "number" || !Number.isFinite(input.code)) return null;
  if (!isFailureKind(input.kind)) return null;
  return { message: input.message, code: input.code, kind: input.kind, ...readFacts(input) };
}

export function isModelFailure(value: unknown): value is ModelFailure {
  return readModelFailure(value) !== null;
}
