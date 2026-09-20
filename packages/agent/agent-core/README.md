---
description: "The Agent handle, live registry, process-local initiator scope, and agent/* event vocabulary for plugins, UI, and orchestrators building or extending agents."
kind: "package-reference"
---

# agent

English | [中文](README.zh.md)

## Summary

`agent` is the plugin a front end actually talks to. One `run` call loads the history from `session`, prepends a system prompt built from the configured base, the working directory and the available skills, runs the model and tool loop, and saves the turn back. It provides `agent.loop@1.1.0`, whose methods are `run` and `info`. The loop itself lives in [`../agent-loop`](../agent-loop/README.md); this directory owns the config, the prompt, the session bookkeeping and the tool wiring around it. The profile config spawns this package: `lib/index.js`, built from [`src/index.ts`](src/index.ts).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

A front end reaches this plugin through the `agent.loop` capability.

### Methods

| Method | Answer |
|---|---|
| `run` | A stream. It requires `meta.stream`; a call without it is rejected. |
| `info` | `{ levels, thinking }`: the accepted thinking levels and the configured table. |

### Inputs to `run`

| Input | Meaning |
|---|---|
| `session_id` | The stored session this turn belongs to. Defaults to `default`. |
| `cwd` | The working directory of the session. Absent or empty means the session has none. |
| `input` | The user's message. An empty string runs the stored history as it stands. |
| `thinking` | The level: `off`, `low`, `medium` or `high`. Defaults to `off`. |

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `max_steps` | `8` | How many model calls one turn may make. |
| `max_parallel_tools` | `4` | How many safe tool calls one batch may run at once. |
| `system` | the shipped coding-assistant prompt | The base system prompt. |
| `thinking` | `{}` | Per level, a `model` and a `tools` flag. Write a level as a bare model name, or as a table. |

An unknown level name is rejected with `-32602` when `run` is called, and an unknown key in `plugins.agent-core.config` is named by `pnpm check:config`.

### Events

`run` pushes the loop's own events, a `tick` every 10 s, and a closing `done`.

| Event | Payload | Meaning |
|---|---|---|
| `tick` | none | The turn is still alive. |
| `done` | `{ steps, text, reason }` | The turn ended. `reason` is `completed`, `aborted` or `max_steps`. |

### Tools

When `skill` is available its skills are listed in the system prompt and one extra tool, `skill`, is offered. Every other tool comes from `tools`. A tool that declares a host argument is given that value before the call, `session_cwd` today, unless the model set the argument itself; the argument is stripped from the specs the model is shown, so the model cannot move a call out of the session directory. Safety is asked through `tools.classify`, and the `skill` tool answers safe on its own.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, `requires`, `run`, `info` and `selfCheck` |
| [`src/prompt.ts`](src/prompt.ts) | `systemPrompt`: the base prompt, the working directory and the skill list |
| [`src/tools.ts`](src/tools.ts) | The `skill` tool spec, `readToolList`, `stripHostArgs` and `injectHostArgs` |

### One turn

`run` lists the tools and skills, loads the stored session, appends the new input when it is not empty, and saves that history before the first model call, so a turn that dies mid flight still leaves a session behind. It then builds one message array, the system prompt first and the history after it, and runs the loop. When the loop returns, the same array without the system message is saved again together with the turn's title.

Cancelling the request aborts the model call and any tool in flight, and the session keeps whatever was already appended. The only event this plugin adds beyond the loop's own is the heartbeat: one `tick` every 10 s while a turn is running.

### Config checks

`selfCheck` covers the pure parts of this directory: the thinking-level reader, the title cutter, host-argument injection and stripping, `readToolList`, one scripted run that must end `completed`, and one that must end `max_steps`. A `--check` run fails when any of them drifts, so `pnpm check:plugins` catches it without a kernel and without a model.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-loop](../agent-loop/README.md): the loop engine this plugin runs.
- [agent package](../README.md): how the plugin and the loop divide the work.
- [packages group](../../README.md): the plugin tree and which plugin owns which capability.
- [maota CLI](../../../apps/cli/README.md): the front end that drives `agent.loop`.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **It never picks a model**: the thinking level supplies a name and the gateway holds the mapping.
- **No context compaction**: a long session is replayed whole on every turn.
- **No failure classification**: a rejected model call ends the turn with a stream error, and nothing retries.
- **`max_steps` is a hard stop**: the messages stay, the turn simply reports `max_steps`.
- **A turn is saved before it starts**: an interrupted turn leaves the session with its trailing user message.
