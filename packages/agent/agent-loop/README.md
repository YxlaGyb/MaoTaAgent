---
description: "The default agent driver for users and maintainers choosing, configuring, or debugging how agents are created and how turns and steps run."
kind: "package-reference"
---

# agent-loop

English | [中文](README.zh.md)

## Summary

The loop engine one turn runs on: call the model, run the tools it asked for, feed the results back, repeat. It reads no config, touches no session and knows nothing about the gateway, because [`../agent-core`](../agent-core/README.md) supplies both as seams. Every run ends with one reason: `completed`, `aborted`, `max_steps` or `stopped`, and the plugin driving the run may report `refused` for a prompt it never sent. Three optional seams share the turn with that plugin: `preTool` before a call is classified, `postTool` after one settled, and `atStop` when the model asked for nothing more. A tool round groups consecutive calls that classified as safe into one batch of at most `max_parallel`, and runs every other call alone. The module is five files with one exported entry, `runLoop`, and it emits only the events of the turn it is running.

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
| `preTool(call, ctx)` | Runs before `classify`: a refusal from it means the call is neither classified nor dispatched. An `allow` grants nothing, because `classify` and the tool's own approval still run. |
| `postTool(call, outcome, ctx)` | Runs once the call has settled, before the text the seams contributed is written. It may end the run, and it may add text to the conversation. |
| `atStop(state, ctx)` | Runs only when the model asked for no tool call, which is the moment the run would end. It may add text, and it may ask for one more step. |

### The step context

Every seam receives a `StepContext`.

| Member | Meaning |
|---|---|
| `state` | `{ messages, step, maxSteps, lastReason, stopSteered, haltRequested }`. `state.messages` is the run's only message truth. |
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
| `reason` | `completed`, `aborted`, `max_steps`, `refused` or `stopped`. `refused` and `stopped` are the caller's own refusals, reported by the plugin that drives the loop; the loop itself ends as `completed`, `aborted`, `max_steps` or `stopped`. |

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
| [`src/execute.ts`](src/execute.ts) | The tool execution seam: the pre-tool decision, classification, batching and one round in call order |
| [`src/events.ts`](src/events.ts) | `LoopExitReason`, `LoopEvent`, `LoopState`, `StepContext`, `LoopDeps`, `PreToolDecision`, `PostToolDecision`, `StopDecision` and `LoopOutcome` |
| [`src/messages.ts`](src/messages.ts) | `Message`, `ToolSpec`, `ToolCall`, `toolCalls`, `parseArgs` and `asText` |
| [`src/index.ts`](src/index.ts) | Re-exports |

### The step loop

The loop continues while the assistant message carries tool calls, and it never reads `stop_reason`, because a streaming reply can carry a tool call before that field settles. Each step emits `step`, calls `chat`, and appends the assistant message. A message that carries no tool call is the moment the run would end, so the stop seam is asked first: the text it contributes is appended, and a steer it asks for buys exactly one more step, after which the run ends as `completed`. The loop records that it has already been steered, so a seam that always asks for one more cannot keep the run alive forever, and `max_steps` remains the backstop. Otherwise the calls go to `execute.ts`; the run ends as `stopped` when a post-tool decision asked for a halt, and the signal is checked before a step and after every tool round, so a turn cancelled either way reports `aborted`.

### Tool rounds

`execute.ts` is the single place a round runs. It asks `preTool` about every call first, in call order, and a refusal means the call is neither classified nor dispatched. The calls that were not refused then go to `classify`, whose answers decide the grouping: consecutive answers of a strict `true` form one batch, capped at `max_parallel`, while any call that did not answer that way, and every refused call, becomes a batch of its own. Batches run in order and only the calls inside one batch may overlap, which is what keeps an unsafe call from running beside anything at all. Before a batch starts, every call in it emits `tool_call`; as each call settles it emits `tool_result` carrying its `id`, so results may arrive in another order than the calls were emitted in. Once the batch has settled, one `role: "tool"` message is appended per call, in the original call order, carrying the call id as `tool_call_id`. A refusal settles the way a throw does, `ok: false` with `{ error }` content, so the model is told why and the round continues. Once the batch is written back, `postTool` is asked about each call that settled: the text the two seams collected is appended as one user message per source, right after the results it belongs to, and a halt ends the round after that batch. When the signal aborts, the remaining batches do not start and the calls that already finished keep their messages.

A different policy, such as execution that starts while the model is still streaming, enters by replacing this file. `loop.ts` does not depend on the policy.

### Message parsing

`toolCalls` reads the calls off an assistant message: a missing or non-array `tool_calls` counts as none, a call with no function name is dropped, and a call without an id becomes `call_<index>`. Arguments arrive as a JSON string, so `parseArgs` falls back to `{ raw }` when they do not parse and to `{}` when they are empty.

### Config checks

`selfCheck` in `agent-core` drives this module through scripted seams. The repository also keeps a test beside it, in [`tests/loop.smoke.ts`](tests/loop.smoke.ts), which covers completion, a two-call round, a tool that throws, an exhausted budget, an abort before the first step, an abort inside a tool round, malformed assistant messages, batching and its cap, an unsafe call splitting a round, out-of-order results, a refused call that is neither classified nor dispatched and still leaves an `{ error }` result, injected text landing right after the results it belongs to, a halt ending the run as `stopped`, one steer continuing the run exactly once, a cancelled run and a run at its step ceiling never reaching the stop seam, and a missing or throwing `classify` or lifecycle seam. It needs no kernel and no network, and `pnpm loop:smoke` runs it alone.

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
