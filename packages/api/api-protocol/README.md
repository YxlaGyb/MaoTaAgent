---
description: "The gateway failure dialect: the canonical codes, the kind vocabulary a recovery policy is written in, and the shape a failure takes when it crosses a process boundary."
kind: "package-reference"
---

# api-protocol

English | [中文](README.zh.md)

## Summary

The words one gateway call fails in. It holds one file and no dependency: the canonical code per way a call can end without an answer, the kind each code belongs to, the fields a failure carries when it crosses a process boundary, and the readers that turn an error or a wire payload into that shape. A numeric code is what an adapter observes; a kind is what a deployment configures a policy with, so no config ever names a number. Nothing here retries, waits or decides: it names the facts, and the policy that reads them lives elsewhere.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The codes

`GATEWAY_ERROR` names one code per way a gateway call can fail, and `ABORTED` names the one code a call cancelled by its own caller carries.

| Constant | Code | Kind |
|---|---|---|
| `GATEWAY_ERROR.auth` | `-32050` | `auth` |
| `GATEWAY_ERROR.rate_limit` | `-32051` | `rate_limit` |
| `GATEWAY_ERROR.server` | `-32052` | `server` |
| `GATEWAY_ERROR.transport` | `-32053` | `transport` |
| `GATEWAY_ERROR.parse` | `-32054` | `protocol` |
| `GATEWAY_ERROR.empty` | `-32055` | `empty_response` |
| `GATEWAY_ERROR.context_window` | `-32056` | `context_window` |
| `GATEWAY_ERROR.timeout` | `-32057` | `timeout` |
| `GATEWAY_ERROR.quota` | `-32058` | `quota` |
| `ABORTED` | `-32013` | `aborted` |

`-32602`, the code a refused request carries, reads as the kind `request`. A code this build does not know reads as `unknown`, which is not a guess at a kind: it says nobody has a policy for this failure.

### The kinds

A kind is the unit a policy is written in, so `isTransient(kind)` answers whether a policy may consider retrying one.

| Kind | Transient | Meaning |
|---|---|---|
| `rate_limit` | Yes | The gateway is limiting how often it is called. |
| `server` | Yes | The gateway or the request failed upstream. |
| `transport` | Yes | The connection broke. |
| `timeout` | Yes | The call was abandoned because nothing arrived in time. |
| `empty_response` | Yes | The call finished without any content. |
| `context_window` | No | The conversation no longer fits the model. |
| `auth` | No | The credentials were refused, or none were found. |
| `quota` | No | The account has nothing left to spend. |
| `request` | No | The request itself was refused. |
| `protocol` | No | A payload could not be read. |
| `aborted` | No | The caller cancelled. |
| `unknown` | No | Nobody has a policy for this failure. |

`TRANSIENT_KINDS` is that column as a list, and `FAILURE_KINDS` is every kind in order.

### The shapes

| Type | Fields |
|---|---|
| `ModelFailure` | `message`, `code`, `kind`, and optionally `status`, `retry_after_ms`, `request_id`. |
| `FailureFacts` | The optional three on their own: what the wire said about a failure, so nothing downstream parses error text. |

Every field but `message`, `code` and `kind` is optional, because only the wire knows whether it has them; a policy that needs one handles its absence.

### The readers

| Function | Input | Answer |
|---|---|---|
| `kindOfCode(code)` | a number | The kind that code belongs to, or `unknown`. |
| `isFailureKind(value)` | anything | Whether the value is one of `FAILURE_KINDS`. |
| `isTransient(kind)` | a kind | Whether a policy may consider retrying it. |
| `readFacts(value)` | anything | The `FailureFacts` a payload carries, dropping every field it cannot use. |
| `parseRetryAfter(value, now?)` | a `Retry-After` header | The delay in milliseconds, from either seconds or an HTTP date. Undefined when nobody can act on it. |
| `failureOf(error)` | a thrown value | The `ModelFailure` that error already is, keeping its code and its data. |
| `readModelFailure(value)` | a payload from another process | The `ModelFailure`, or null when any required field is missing or wrong. |
| `isModelFailure(value)` | anything | Whether the value reads as a `ModelFailure`. |

`failureOf` never throws and never invents a kind: an error with no readable code becomes `-32603` and the kind `unknown`. `readModelFailure` checks every field, because its reader is a process that did not build the payload, which is the one boundary where a shape must be verified rather than trusted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Everything: the codes, the kinds, the shapes, the readers. |

### Why a kind sits beside every code

A code is a fact about one adapter, and adapters disagree: one provider reports the same condition as HTTP 429, another only inside the body, another as a quota exhausted. A deployment cannot write a policy over that, and should not have to name a number to say "try again later". So the adapter reports the code it saw, `kindOfCode` reduces it to a kind, and the policy is written over kinds. Adding an adapter means mapping its conditions onto these kinds, never adding a kind per provider.

Two records hold this dialect together. `BY_CODE` is the only place a number becomes a kind, so a code that is not in it is unknown rather than guessed. `TRANSIENT_KINDS` is the only place "could plausibly go away" is written down, and it deliberately includes `empty_response`, because a gateway that answered with nothing is worth another try. Nothing here retries: an adapter reports facts, and only a policy acts on them, so this package stays a leaf that both sides can import.

### What a failure carries across a boundary

Three optional fields travel with a failure because a policy may want them and nothing else can recover them: `status`, the HTTP status the gateway answered with; `retry_after_ms`, how long it asked to be left alone, already converted from whichever form it named; and `request_id`, the identifier a provider support channel would ask for. `readFacts` is what makes them safe to carry, dropping anything that is not a finite number, a positive number, or a non-empty string. A failure that crossed a process boundary is checked by `readModelFailure`, since the sender is a process this one did not build, and a failure that is still an error object in this process is read by `failureOf`, which trusts its own code path.

-----

<a id="further-exploration"></a>
## Further exploration

- [api](../README.md): the adapter that reports these codes and carries these facts.
- [retry policy](../src/retry.ts): the policy written in these kinds, one per provider address.
- [api package](../README.md): the group this dialect belongs to.
