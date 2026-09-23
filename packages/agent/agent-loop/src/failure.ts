/// The loop's view of a failed model call. The vocabulary itself belongs to the
/// wire dialect, so a kind is never redefined here; what this file adds is the
/// shape a failure takes when it is worn as an error, which is how a rejection
/// and a reported outcome say the same thing.

import { failureOf, type FailureFacts, type FailureKind, type ModelFailure } from "@maota/api-protocol";

export { isTransient, kindOfCode, readModelFailure } from "@maota/api-protocol";
export type { FailureKind, ModelFailure } from "@maota/api-protocol";

/// A failure a consumer can no longer act on, carried as an error so the throw
/// and the report are one fact. `data` holds exactly the facts the wire stated,
/// which is what lets the protocol's own reader work on it unchanged.
export class ModelFailureError extends Error {
  readonly code: number;
  readonly kind: FailureKind;
  readonly data: FailureFacts;

  constructor(failure: ModelFailure) {
    super(failure.message);
    this.name = "ModelFailureError";
    this.code = failure.code;
    this.kind = failure.kind;
    this.data = {
      ...(failure.status === undefined ? {} : { status: failure.status }),
      ...(failure.retry_after_ms === undefined ? {} : { retry_after_ms: failure.retry_after_ms }),
      ...(failure.request_id === undefined ? {} : { request_id: failure.request_id }),
    };
  }
}

/// Anything thrown at a model-call boundary becomes a failure, and anything the
/// dialect cannot name becomes `unknown` rather than a guess, so a defect in
/// this process is never read as a provider that answered badly.
export function failureOfError(error: unknown): ModelFailure {
  return failureOf(error);
}
