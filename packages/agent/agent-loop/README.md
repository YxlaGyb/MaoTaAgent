---
description: "The default agent driver for users and maintainers choosing, configuring, or debugging how agents are created and how turns and steps run."
kind: "package-reference"
---

# agent-loop

English | [中文](README.zh.md)

## Summary

The loop engine one turn runs on: call the model, run the tools it asked for, feed the results back, repeat. It reads no config, touches no session and knows nothing about the gateway, because [`../agent-core`](../agent-core/README.md) supplies both as seams. Every run ends with one reason: `completed`, `aborted` or `max_steps`. A tool round groups consecutive calls that classified as safe into one batch of at most `max_parallel`, and runs every other call alone. The module is five files with one exported entry, `runLoop`, and it emits only the events of the turn it is running.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Import the barrel, hand `runLoop` its seams, and read the outcome.

```ts
const outcome = await runLoop(deps, messages, signal, emit);
```

### Dependencies

| Field | Meaning |
|---|---|
| `tools` | The tool specs offered to the model. |
| `max_steps` | How many model calls one run may make. |
| `max_parallel` | How many calls one batch may run at once. Omitted or invalid means 1, which is one call at a time. |
| `classify(call, ctx)` | Whether this call may run beside another. A missing seam, an answer that is not strictly `true`, or a throw all mean no. |
| `callTool(call, ctx)` | One tool call. Throw to report a tool that failed. |

### The step context

Both seams receive a `StepContext`.

| Member | Meaning |
|---|---|
| `state` | `{ messages, step, maxSteps, lastReason }`. `state.messages` is the run's only message truth. |
| `tools` | The same specs, for a seam that needs them mid step. |
| `step` | The current model call, counting from 1. |
| `signal` | Aborted when the caller cancelled the turn. |
| `emit(event)` | Pushes a loop event. |
| `delta(chunk)` | Pushes streamed model text, which the loop turns into `text` and `reasoning` events. |

### The outcome

| Field | Meaning |
|---|---|
| `steps` | Model calls started. |
| `text` | The final assistant text, empty when there was none. |
| `reason` | `completed`, `aborted` or `max_steps`. |

### Events

| Event | Payload | Meaning |
|---|---|---|
| `step` | `{ step }` | A model call is starting. |
| `text` | `{ text }` | Streamed answer text. |
| `reasoning` | `{ text }` | Streamed reasoning text. |
| `tool_call` | `{ id, tool, args }` | A tool is about to run. |
| `tool_result` | `{ id, tool, ok, output }` | A tool finished. The `id` is the call it answers. |

`tick` and `done` belong to the plugin that calls the loop and not to the loop itself.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/loop.ts`](src/loop.ts) | `runLoop`: the step loop, and the one place an exit reason is decided |
| [`src/execute.ts`](src/execute.ts) | The tool execution seam: classification, batching and one round in call order |
| [`src/events.ts`](src/events.ts) | `LoopExitReason`, `LoopEvent`, `LoopState`, `StepContext`, `LoopDeps` and `LoopOutcome` |
| [`src/messages.ts`](src/messages.ts) | `Message`, `ToolSpec`, `ToolCall`, `toolCalls`, `parseArgs` and `asText` |
| [`src/index.ts`](src/index.ts) | Re-exports |

### The step loop

The loop continues while the assistant message carries tool calls, and it never reads `stop_reason`, because a streaming reply can carry a tool call before that field settles. Each step emits `step`, calls `chat`, appends the assistant message, and ends as `completed` when no tool call came back. Otherwise it hands the calls to `execute.ts` and checks the signal again. The signal is checked before a step and after a tool round, and a run that stops either way reports `aborted`.

### Tool rounds

`execute.ts` is the single place a round runs. It asks `classify` about every call first, then groups the calls: consecutive answers of a strict `true` form one batch, capped at `max_parallel`, while any call that did not answer that way becomes a batch of its own. Batches run in order and only the calls inside one batch may overlap, which is what keeps an unsafe call from running beside anything at all. Before a batch starts, every call in it emits `tool_call`; as each call settles it emits `tool_result` carrying its `id`, so results may arrive in another order than the calls were emitted in. Once the batch has settled, one `role: "tool"` message is appended per call, in the original call order, carrying the call id as `tool_call_id`. A tool that throws becomes `{ error }` content and the round continues, so one bad tool never ends the run. When the signal aborts, the remaining batches do not start and the calls that already finished keep their messages.

A different policy, such as execution that starts while the model is still streaming, enters by replacing this file. `loop.ts` does not depend on the policy.

### Message parsing

`toolCalls` reads the calls off an assistant message: a missing or non-array `tool_calls` counts as none, a call with no function name is dropped, and a call without an id becomes `call_<index>`. Arguments arrive as a JSON string, so `parseArgs` falls back to `{ raw }` when they do not parse and to `{}` when they are empty.

### Config checks

`selfCheck` in `agent-core` drives this module through scripted seams. The repository also keeps a test beside it, in [`tests/loop.smoke.ts`](tests/loop.smoke.ts), which covers completion, a two-call round, a tool that throws, an exhausted budget, an abort before the first step, an abort inside a tool round, malformed assistant messages, batching and its cap, an unsafe call splitting a round, out-of-order results, and a missing or throwing `classify`. It needs no kernel and no network, and `pnpm loop:smoke` runs it alone.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-core](../agent-core/README.md): the plugin that supplies the model and tool seams.
- [agent package](../README.md): how the plugin and this engine divide the work.
- [packages group](../../README.md): the plugin tree this module belongs to.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Batching is consecutive only**: one unsafe call splits the round, so two safe calls either side of it never share a batch.`n- **Nothing starts while the model is still streaming**: a round waits for the assistant message to finish.
- **No failure classification and no retry**: a rejected model call is the caller's problem, and the loop never tries again on its own.
- **No context compaction**: the message array grows until the caller stops handing it back.
- **The loop persists nothing**: saving a turn belongs to the plugin, and so does every config value.
- **`steps` counts started calls**: a run aborted inside a step reports that step as its count.
