# The hook points

English | [中文](hooks.zh.md)

A hook is a plugin that wants a say at a point in the agent loop without the loop knowing about it. This document owns that arrangement: where the twelve points sit in one turn, what a hook is written in, who translates between the loop and the hook dialect, and the one invariant that keeps hooks from weakening anything. The loop engine knows no hook: it opens three seams and declares the decisions it consumes, and everything hook-shaped lives on the hook side of a bridge.

## Table of Contents

- [Where the twelve points sit](#where-the-twelve-points-sit)
- [The dialect](#the-dialect)
- [The bridge](#the-bridge)
- [Hooks only tighten](#hooks-only-tighten)
- [Related documentation](#related-documentation)

-----

<a id="where-the-twelve-points-sit"></a>
## Where the twelve points sit

One turn passes twelve points, named the way the wider hook ecosystem names them.

| Point | Fires | What a hook can do |
|---|---|---|
| `UserPromptSubmit` | Before the prompt is assembled into messages, and before anything is written down. | Refuse the prompt, or add context. |
| `SessionStart` | Once the run is allowed to begin, before the tools are listed. | Add context, which lands before the first step. |
| `PreModel` | Before each model call. | Add context. |
| `PostModel` | After each model call settled. | Add context. |
| `PreToolUse` | Before a tool call is dispatched, and before it is classified. | Refuse the call, replace its arguments, or add context. |
| `PostToolUse` | After the call settled, before its result is written back. | Ask for the turn to end, replace what the model is told it returned, or add context. |
| `PreCompact` | Before a long history is folded, and only when a fold is about to happen. | Add context. |
| `SubagentStart` | When a delegation begins, before its first model call. | Add context. |
| `SubagentStop` | When a delegation ends, whichever way it ended. | Add context. |
| `Notification` | When a run stops for a reason the model never got to say. | Add context, so somebody can be told. |
| `Stop` | When the model asked for no tool call, which is the moment the turn would end. | Say one more thing before it does, or add context. |
| `SessionEnd` | When the run ends, whichever way it ended. | Add context. |

The loop engine owns the three seams behind the tool and stop points. It declares the decisions it consumes: `PreToolDecision` (`decision`, `reason`, `args`, `context`), `PostToolDecision` (`context`, `halt`, `output`) and `StopDecision` (`context`, `steer`). A refused pre-tool decision never reaches `classify` or the tool, and the caller is told why; a post-tool halt ends the turn after the batch that asked for it; a stop steer continues the run exactly once, because the loop records that it has already been steered and `max_steps` remains the backstop. A turn therefore ends as one of five reasons: `completed`, `aborted`, `max_steps`, `refused` or `stopped`.

The prompt point has no seam of its own, because nothing in the loop applies to a prompt: `agent-core` asks the hook before it assembles messages. A refusal there writes nothing to the session and calls no model; the caller receives a closing event with `steps: 0`, the hook's reason as its text, and `refused` as its reason.

The eight points the loop has no seam for are heard all the same. `agent-core` writes the context they contribute into the turn as a `hook:<name>` message, at the position the point occupies, so a note added at `SessionStart` is read by the first model call and a note added at `SessionEnd` is read by the next turn. Only that field is consumed there: a point that exists to tell a hook something cannot be turned into a rewrite of a call it has no part in.

A subagent reaches every point except two. `UserPromptSubmit` and `Stop` are the seams of a person's turn: a subagent has no prompt of its own and takes no continuation instruction, so neither fires for one. Its calls carry the parent's `session_id` and `call_id` and a `subagent` field naming the child, so a hook that reads the payload cannot tell a subagent's call from the session's own by position alone, and the session, model and compact points carry `subagent: true`.

Text a hook injects becomes a user message named `hook:<name>`, so a reader of the stored session can tell it from what the person typed. Injected text is written with the session, and it is placed where it belongs in the turn: after the history and before the first step for a prompt, immediately after the tool results of the call it is about for a tool point, and at the point itself for the rest. A steered continuation carries the name `hook:stop`.

<a id="the-dialect"></a>
## The dialect

The hook side owns its own vocabulary, and it lives in one zero-dependency package so that a hook author and the engine can share it without either importing the other.

- [`hook-protocol`](../../packages/hooks/hook-protocol/README.md) holds the twelve event names, the payload each carries, `HookReply` (what one hook writes), `HookOutcome` (what several replies fold into), the `hook.*` provider contract and the merge.
- [`hooks-native`](../../packages/hooks/hooks-native/README.md) provides the `hooks` capability `agent-core` calls: it discovers the `hook.*` capabilities the kernel published plus the command hooks the profile listed, asks the ones that declared the event, merges their answers, stamps each contribution with the hook it came from, and logs a line.
- [the hooks package group](../../packages/hooks/README.md) is the pair described together.

A hook declares the capability `hook.<name>`, answers `describe` with the events it implements, and implements one method per declared event, named after the event, taking that event's payload. That capability is the entire registration: there is no register call, no teardown, and no state to keep in step with a reload. A hook may instead be a command, listed by the profile or registered by a run for its own length; it is handed the event as JSON on stdin and answers with one JSON object on stdout, and every run of it leaves a line in `$MAOTA_HOME/audit/hooks.jsonl`.

The merge is decided by strictness rather than by order. A single refusal beats any number of questions and allowances, a single question beats any number of allowances, and only the reasons of whichever won survive, joined by a blank line. Context accumulates in hook order, clipped per entry, each piece still labelled with the hook that wrote it. `preventContinuation` is true when any hook asked for it; a steer, a set of replacement arguments and a replacement output each come from the first hook that offered one. The fan out goes in capability-name order, so the same hooks answer in the same order every time, and by default the hooks that declared one event are asked at once.

<a id="the-bridge"></a>
## The bridge

`agent-core` is the only file that knows both vocabularies, and it is the only place a hook field is renamed. It calls `hooks.trigger` once per point, then maps the answer onto the decisions the loop declared, dropping any field that seam has no use for. Nothing else in the deployment needs both sides, which is why the loop can stay free of hook names and the hook packages can stay free of loop types.

A post-tool refusal deserves one note, because the seam has only three fields: a refusal there is read as a request to end the turn, and its reason rides along as context so the model learns why. A hook that wants to stop the turn without saying anything uses `preventContinuation` instead.

`PreToolUse` is the one point a question can come out of. A hook that answers `ask` hands the call to the permission layer, and that answer becomes the decision; a refusal is never asked about, and an `ask` with nobody to ask is a refusal, because a question must not quietly turn into a yes.

The bridge is also where the prompt refusal is turned into a closing event, so the shape a front end sees is a `done` event like any other, with `steps: 0` and nothing written down. And it is where the context every other point contributes is written into the turn, so the loop needs no seam for a point that has no decision to consume.

<a id="hooks-only-tighten"></a>
## Hooks only tighten

A hook may refuse; it may never exempt a call from anything.

- `PreToolUse` runs before classification, so a refused call is neither classified nor dispatched. A call that a hook allows is still classified exactly as before, and the tool still asks its own approval if it asks one.
- `UserPromptSubmit` runs before the prompt is stored, so a refusal cannot be recorded and cannot reach the model.
- `PostToolUse` and `Stop` can end a turn, and cannot add a step beyond the one steer the loop allows itself.
- A hook that fails has no opinion rather than a veto or a pass: a hook that throws, cannot be reached or times out is logged and skipped, so the layers underneath decide as they always did. Those layers already fail closed, which is what makes it safe to be forgiving here.

Nothing in the kernel inspects a hook: hooks are capabilities the engine routes like any other, and a deployment with no hook mounted behaves exactly as though the feature did not exist. A hook acts at the twelve points listed above and nowhere else: there is no kernel-level interception of an arbitrary call, and the two dozen further events the wider ecosystem names are not carried here.

<a id="related-documentation"></a>
## Related documentation

- [hooks package group](../../packages/hooks/README.md): the two packages and how they are mounted.
- [hook-protocol](../../packages/hooks/hook-protocol/README.md): the events, payloads, provider contract and merge rules.
- [hooks-native](../../packages/hooks/hooks-native/README.md): the engine, its methods and its config.
- [agent-loop](../../packages/agent/agent-loop/README.md): the seams and the exit reasons.
- [the permission gate](permission.md): the layer that decides whether an operation runs at all.
- [architecture](../architecture.md): where the hooks sit in the whole system.