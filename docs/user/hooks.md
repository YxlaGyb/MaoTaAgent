# The hook points

English | [中文](hooks.zh.md)

A hook is a plugin that wants a say at a point in the agent loop without the loop knowing about it. This document owns that arrangement: where the four points sit in one turn, what a hook is written in, who translates between the loop and the hook dialect, and the one invariant that keeps hooks from weakening anything. The loop engine knows no hook: it opens three seams and declares the decisions it consumes, and everything hook-shaped lives on the hook side of a bridge.

## Table of Contents

- [Where the four points sit](#where-the-four-points-sit)
- [The dialect](#the-dialect)
- [The bridge](#the-bridge)
- [Hooks only tighten](#hooks-only-tighten)
- [What this does not cover](#what-this-does-not-cover)
- [Related documentation](#related-documentation)

-----

<a id="where-the-four-points-sit"></a>
## Where the four points sit

One turn passes four points, named the way the wider hook ecosystem names them.

| Point | Fires | What a hook can do |
|---|---|---|
| `UserPromptSubmit` | Before the prompt is assembled into messages, and before anything is written down. | Refuse the prompt, or add context. |
| `PreToolUse` | Before a tool call is dispatched, and before it is classified. | Refuse the call, or add context. |
| `PostToolUse` | After the call settled, before its result is written back. | Ask for the turn to end, or add context. |
| `Stop` | When the model asked for no tool call, which is the moment the turn would end. | Say one more thing before it does, or add context. |

The loop engine owns the three seams behind those points. It declares the decisions it consumes: `PreToolDecision` (`decision`, `reason`, `context`), `PostToolDecision` (`context`, `halt`) and `StopDecision` (`context`, `steer`). A refused pre-tool decision never reaches `classify` or the tool, and the caller is told why; a post-tool halt ends the turn after the batch that asked for it; a stop steer continues the run exactly once, because the loop records that it has already been steered and `max_steps` remains the backstop. A turn therefore ends as one of five reasons: `completed`, `aborted`, `max_steps`, `refused` or `stopped`.

The prompt point has no seam of its own, because nothing in the loop applies to a prompt: `agent-core` asks the hook before it assembles messages. A refusal there writes nothing to the session and calls no model; the caller receives a closing event with `steps: 0`, the hook's reason as its text, and `refused` as its reason.

A subagent reaches two of the four points and no more. Its calls fire `PreToolUse` and `PostToolUse`, carrying the parent's `session_id` and `call_id` and a `subagent` field naming the child, so a hook that reads the payload cannot tell a subagent's call from the session's own by position alone. `UserPromptSubmit` and `Stop` are the seams of a person's turn: a subagent has no prompt of its own and takes no continuation instruction, so neither fires for one.

Text a hook injects becomes a user message named `hook:<name>`, so a reader of the stored session can tell it from what the person typed. Injected text is written with the session, and it is placed where it belongs in the turn: after the history and before the first step for a prompt, and immediately after the tool results of the call it is about for a tool point. A steered continuation carries the name `hook:stop`.

<a id="the-dialect"></a>
## The dialect

The hook side owns its own vocabulary, and it lives in one zero-dependency package so that a hook author and the engine can share it without either importing the other.

- [`hook-protocol`](../../packages/hooks/hook-protocol/README.md) holds the four event names, the payload each carries, `HookReply` (what one hook writes), `HookOutcome` (what several replies fold into), the `hook.*` provider contract and the merge.
- [`hooks-native`](../../packages/hooks/hooks-native/README.md) provides the `hooks` capability `agent-core` calls: it discovers the `hook.*` capabilities the kernel published, asks the ones that declared the event, merges their answers, stamps each contribution with the hook it came from, and logs a line.
- [the hooks package group](../../packages/hooks/README.md) is the pair described together.

A hook declares the capability `hook.<name>`, answers `describe` with the events it implements, and implements one method per declared event, named after the event, taking that event's payload. That capability is the entire registration: there is no register call, no teardown, and no state to keep in step with a reload.

The merge is decided by strictness rather than by order. A single refusal beats any number of allowances and only the refusals' reasons survive, joined by a blank line. Context accumulates in hook order, clipped per entry, each piece still labelled with the hook that wrote it. `preventContinuation` is true when any hook asked for it, and a steer comes from the first hook that offered one. The fan out itself goes in capability-name order, so the same hooks answer in the same order every time.

<a id="the-bridge"></a>
## The bridge

`agent-core` is the only file that knows both vocabularies, and it is the only place a hook field is renamed. It calls `hooks.trigger` once per point, then maps the answer onto the decisions the loop declared, dropping any field that seam has no use for. Nothing else in the deployment needs both sides, which is why the loop can stay free of hook names and the hook packages can stay free of loop types.

A post-tool refusal deserves one note, because the seam has only two fields: a refusal there is read as a request to end the turn, and its reason rides along as context so the model learns why. A hook that wants to stop the turn without saying anything uses `preventContinuation` instead.

The bridge is also where the prompt refusal is turned into a closing event, so the shape a front end sees is a `done` event like any other, with `steps: 0` and nothing written down.

<a id="hooks-only-tighten"></a>
## Hooks only tighten

A hook may refuse; it may never exempt a call from anything.

- `PreToolUse` runs before classification, so a refused call is neither classified nor dispatched. A call that a hook allows is still classified exactly as before, and the tool still asks its own approval if it asks one.
- `UserPromptSubmit` runs before the prompt is stored, so a refusal cannot be recorded and cannot reach the model.
- `PostToolUse` and `Stop` can end a turn, and cannot add a step beyond the one steer the loop allows itself.
- A hook that fails has no opinion rather than a veto or a pass: a hook that throws, cannot be reached or times out is logged and skipped, so the layers underneath decide as they always did. Those layers already fail closed, which is what makes it safe to be forgiving here.

Nothing in the kernel inspects a hook: hooks are capabilities the engine routes like any other, and a deployment with no hook mounted behaves exactly as though the feature did not exist.

<a id="what-this-does-not-cover"></a>
## What this does not cover

- No command hooks and no bridge to a `hooks.json` file: a hook is a plugin with a capability, and an external command line is not a hook in this version.
- No `ask` decision: a hook allows or refuses, and never hands the question to a person. The approval gate remains the only thing that asks.
- No input or output rewriting: a hook decides whether a call runs, never what it runs with or what it returns.
- No durable hook audit: a hook's decision is a log line and, when it injects context, a message in the session. There is no separate hook log to read back.
- Four events, not the two dozen the wider ecosystem names, and no kernel-level interception: a hook acts at the points listed above and nowhere else.

<a id="related-documentation"></a>
## Related documentation

- [hooks package group](../../packages/hooks/README.md): the two packages and how they are mounted.
- [hook-protocol](../../packages/hooks/hook-protocol/README.md): the events, payloads, provider contract and merge rules.
- [hooks-native](../../packages/hooks/hooks-native/README.md): the engine, its methods and its config.
- [agent-loop](../../packages/agent/agent-loop/README.md): the seams and the exit reasons.
- [the permission gate](permission.md): the layer that decides whether an operation runs at all.
- [architecture](../architecture.md): where the hooks sit in the whole system.
