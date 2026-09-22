---
description: "The model gateway for maintainers wiring a backend, choosing between the OpenAI and scripted ones, or debugging what a provider is sent and what a failed call costs."
kind: "package-reference"
---

# api

English | [中文](README.zh.md)

## Summary

`api` is the model gateway: the one plugin between the agent loop and a provider, so the loop asks for a chat completion and never learns which backend answered. It offers an OpenAI-compatible backend and a scripted one for tests and demos, retries the failures that could plausibly go away, and projects every outgoing message onto a small wire whitelist, so a field the harness keeps for itself cannot travel back as if the model had written it. Two methods answer a caller, `chat` and `key`, and this is the only plugin that holds a credential. It requires no other capability.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

Reach it through the `api` capability.

| Method | Params | Returns |
|---|---|---|
| `chat` | `{ messages, tools?, model?, temperature? }` | The assistant message. Streaming when the caller passes `meta.stream`, in which case the same call arrives on the stream as `delta`, `reasoning` and a closing `message`. |
| `key` | none | `{ has_key }`. |
| `key_set` | `{ api_key }` | `{ has_key }`, after writing the key to `$MAOTA_HOME/api_key` with mode `0600`. An empty string forgets it. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `backend` | `openai` | `openai` or `scripted`. The scripted backend answers from `script` and never opens a socket. |
| `model` | `gpt-4o-mini` | The model a request that names none is sent to. |
| `base_url` | `https://api.openai.com/v1` | Where the OpenAI-compatible backend is. |
| `api_key` | none | The credential itself, written in the config. `api_key_env`, and then the stored key file, are read only when this is empty. |
| `api_key_env` | `OPENAI_API_KEY` | The environment variable the credential is read from. |
| `retry_max` | `2` | How many times a retryable failure is tried again, so a call is made at most `retry_max + 1` times. |
| `retry_backoff_ms` | `500` | The first pause before a retry. It doubles on each further attempt. |
| `script` | `[]` | The scripted backend's steps, in call order: `{ text }` for an answer, `{ tool, args }` for a call. A step past the end answers with a note that the script ran out. |

`readChat` refuses a request whose messages are not a non-empty array, or one message of which has no role, with `-32602`.

### Error codes

| Code | Meaning |
|---|---|
| `-32050` | The gateway rejected the credentials, or none were found. |
| `-32051` | The gateway is rate limiting. Retryable. |
| `-32052` | The gateway or the request failed upstream. Retryable. |
| `-32053` | The connection broke. Retryable. |
| `-32054` | A stream chunk was not JSON. |
| `-32055` | The stream ended without any content. |
| `-32013` | The caller cancelled. Never retried. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The capability: config, the credential, the three methods, the retry and `selfCheck` |
| [`src/messages.ts`](src/messages.ts) | `readChat` and the wire projection |
| [`src/openai.ts`](src/openai.ts) | The OpenAI-compatible backend: `chat`, `streamChat`, `asOpenAITools` and the error mapping |
| [`src/scripted.ts`](src/scripted.ts) | The scripted backend, and the step shape it reads |
| [`src/sse.ts`](src/sse.ts) | `SseParser`, `applyDelta`, `createAccumulator` and `messageFromAccumulator` |

### Only some failures are retried

A failure is retried when it could plausibly go away: the gateway being busy, broken or unreachable, which is `429`, a `5xx` or a broken connection. A rejected credential, a malformed request, a chunk that is not JSON and a cancelled turn are answers rather than accidents, so they travel back at once. The pause before each retry doubles, and the abort signal ends the waiting as soon as the caller cancels.

A stream is only retried while nothing has been pushed: text the caller has already read cannot be taken back, so a stream that broke after its first delta is reported as it happened instead of being started over.

### The wire projection

`readChat` rebuilds every message from a whitelist of `role`, `content`, `tool_calls`, `tool_call_id` and `name`. The harness keeps more than that: a catalog note carries its `source`, and a message may name the capability it came from. Those are local bookkeeping, and one that leaked to a provider would come back on the next turn as if the model had written it.

### Streaming

The stream is a sequence of frames, and a frame may be cut in half by the network: `SseParser` holds an incomplete line until the rest of it arrives, joins the `data:` lines of one frame with newlines, and treats `[DONE]` as a frame of its own. `applyDelta` folds each frame's delta into one accumulator, which is what turns a provider's streamed fragments of a tool call into the single message the loop expects.

### Config checks

`selfCheck` covers the parts that need no network: the scripted backend's text and tool steps, the wire projection, the SSE parser's half lines and multi-line frames, the accumulator's glued tool arguments, the error mapping including an abort, and the retry rules, which are scripted with a backend that fails a fixed number of times. A `--check` run fails when any of them drifts, so `pnpm check:plugins` catches it without a kernel and without a model.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-core](../agent/agent-core/README.md): the caller that streams a turn through this plugin.
- [plugin-kit](../plugin-kit/README.md): `runPlugin`, `CallError` and the channel a stream arrives on.
- [Architecture](../../docs/architecture.md): where the gateway sits in the launch path.