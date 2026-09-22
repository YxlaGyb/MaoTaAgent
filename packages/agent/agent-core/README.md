---
description: "The Agent handle, live registry, process-local initiator scope, and agent/* and agent.subagent.* event vocabulary for plugins, UI, and orchestrators building or extending agents."
kind: "package-reference"
---

# agent

English | [中文](README.zh.md)

## Summary

`agent` is the plugin a front end actually talks to. One `run` call loads the history from `session`, prepends a system prompt built from the configured base, the working directory and the available skills, runs the model and tool loop, and saves the turn back. It provides `agent.loop@1.3.0`, whose methods are `run` and `info`. The loop itself lives in [`../agent-loop`](../agent-loop/README.md); this directory owns the config, the prompt, the session bookkeeping and the tool wiring around it, and it is also the bridge between the loop and the hooks when an engine is mounted. The profile config spawns this package: `lib/index.js`, built from [`src/index.ts`](src/index.ts).

One input turns a `run` into the other kind of turn this package knows: an `origin` makes it a child run, the run a subagent is made of. A child starts from an empty conversation, keeps the identity of the session that spawned it, answers to a tool surface and a system prompt of its own, and reports its progress on the kernel's bus.

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
| `origin` | Present when this run is a subagent: `{ parent_session_id, parent_call_id?, type?, description? }`. Absent means an ordinary turn. |
| `system` | A system prompt that replaces the configured base for this run. The working directory and the approval policy are still appended, and the skill list never is. |
| `tools_allow` | The tool names this run may use. Absent means the whole pool. |
| `tools_deny` | The tool names to leave out, applied after `tools_allow`. |
| `max_steps` | How many model calls this run may make, over the configured `max_steps`. |

### A child run

The child differs from an ordinary turn in eight ways, and every one of them is visible to a caller:

| Property | Ordinary turn | Child run |
|---|---|---|
| History | Read from the session document. | Empty. The only input is `input`. |
| System prompt | The configured base, the skill list, the working directory and the policy. | `system`, the working directory and the policy. No skill list. |
| Tools | The pool, plus `skill` when skills exist and the level allows tools. | The pool filtered by `tools_allow` and `tools_deny`, and never `skill`. |
| Session written | The turn's own session, titled from the first user message. | A document of its own, carrying the parent link and titled from `description`. |
| Model and level | The one `thinking` names. | The parent run's, from a table this plugin keeps per session while the parent runs. |
| Prompts | `UserPromptSubmit` fires, and `Stop` when the run ends. | Neither fires. |
| Tool hooks | The session's identity. | The parent's `session_id` and `call_id`, plus a `subagent` field. |
| Reporting | The caller's stream, and nothing else. | The caller's stream plus `agent.subagent.*` on the bus. |

The tool surface is filtered in two places on purpose: the child's listing is filtered, so the model never sees a name it may not use, and the pre-tool seam refuses everything outside it, so a name the model invented comes back as a refusal rather than running. The child's calls, questions and hook payloads all carry the parent's `session_id` and `call_id`, which is what lets a front end place a subagent's work under the tool row that started it.

An `origin` that is not an object, or whose `parent_session_id` is missing, is refused with `-32602`, as are a `system` that is not a string, a `tools_allow` or `tools_deny` that is not a list of strings, and a `max_steps` that is not a positive integer. A child that names nothing but its parent gets the type `general`, no `parent_call_id` and an empty description.

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
| `done` | `{ steps, text, reason }` | The turn ended. `reason` is `completed`, `aborted`, `max_steps`, `refused` or `stopped`. `refused` is this plugin's own refusal of the prompt, with `steps` at 0. |

A child run adds nothing to that stream. It publishes its progress on the kernel's bus instead, so a viewer can follow a subagent without the parent's stream changing shape:

| Topic | Payload, beyond the five identity fields |
|---|---|
| `agent.subagent.started` | none |
| `agent.subagent.step` | `step` |
| `agent.subagent.tool_call` | `id`, `tool`, `args` |
| `agent.subagent.tool_result` | `id`, `tool`, `ok`, `output` |
| `agent.subagent.finished` | `steps`, `reason`, `ok` |

Every payload carries `subagent_id`, `parent_session_id`, `parent_call_id`, `type` and `description`. Nothing the child said or reasoned is published: its text belongs to its own session, and what the caller wanted arrives as the result of the call that started it.

### Tools

When `skill` is available its skills are listed in the system prompt and one extra tool, `skill`, is offered. Every other tool comes from `tools`. A tool that declares a host argument is given that value before the call, unless the model set the argument itself, and every host argument is stripped from the specs the model is shown. Safety is asked through `tools.classify`, and the `skill` tool answers safe on its own.

Four sources exist, `session_cwd`, `session_id`, `call_id` and `subagent`, so a tool knows which session it is serving, which call it is running and who is asking, and the model can claim none of them. In a child run the injected session and call id stay the parent's, and `subagent` carries the child's own id, type and description; a tool that declares that fourth source is told which subagent is asking, and every other tool behaves as it always did.

When a `permission` capability answers, the policy for this session is read once per turn and stated in the system prompt, so the model knows what a refusal means instead of retrying a command nobody will approve. Without that capability the prompt says nothing about approval, and the tools that would ask read the same absence as the mode that asks.

### Hooks

When a `hooks` capability answers, four points of the turn are offered to the hooks: `UserPromptSubmit` before the messages are assembled, and the loop's three seams, `PreToolUse` before a call is classified, `PostToolUse` after one settled, and `Stop` when the model asked for nothing more. This file is the only place that knows both vocabularies: it calls `hooks.trigger` once per point and maps the answer onto the decisions the loop declared, so the loop never hears a hook name and the hook packages never see a loop type. A refused prompt is the one path that writes nothing, calls no model, and closes the stream as `done` with `steps` at 0 and `refused` as the reason. The capability is optional: a deployment without the engine simply has no hooks, which is logged once at start.

A child run reaches two of those four points: `PreToolUse` and `PostToolUse` fire for its calls, carrying the parent's `session_id` and `call_id` and a `subagent` field naming the child. `UserPromptSubmit` and `Stop` do not fire for a child, because a subagent has no user turn of its own and takes no continuation instruction.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, `requires`, `run`, `info`, the hook bridge and `selfCheck` |
| [`src/prompt.ts`](src/prompt.ts) | `systemPrompt`: the base prompt, the working directory and the skill list |
| [`src/tools.ts`](src/tools.ts) | The `skill` tool spec, `readToolList`, `stripHostArgs` and `injectHostArgs` with the four host sources |

### One turn

`run` lists the tools and skills, loads the stored session, appends the new input when it is not empty, and saves that history before the first model call, so a turn that dies mid flight still leaves a session behind. It then builds one message array, the system prompt first and the history after it, and runs the loop. When the loop returns, the same array without the system message is saved again together with the turn's title.

Before the session is even read, the prompt is offered to the hooks, and a refusal there ends the turn with nothing stored and no model call. Text a hook contributes lands in the array as a user message named `hook:<name>`: after the history and before the first step for a prompt, and right after the results it belongs to for a tool point.

Cancelling the request aborts the model call and any tool in flight, and the session keeps whatever was already appended. The only event this plugin adds beyond the loop's own is the heartbeat: one `tick` every 10 s while a turn is running.

A child run is the same path with four differences: it reads no history and lists no skills, it writes to a session document of its own that carries the parent link and the description as its title, it publishes the `agent.subagent.*` topics around the run, and it takes the model and the thinking level from the parent run's entry in a process-level table, written when the parent starts and cleared when it ends. A child whose parent is not in that table falls back to the level that grants the tools and names no model, the same fallback as a run with no level at all.

### Config checks

`selfCheck` covers the pure parts of this directory: the thinking-level reader, the title cutter, host-argument injection and stripping, `readToolList`, one scripted run that must end `completed`, and one that must end `max_steps`. The hook bridge is checked there as well: the three mappings keep only the fields their seam consumes, an empty answer counts as no opinion, a post-tool refusal ends the round and carries its reason, and an engine that is absent or that fails comes back as an empty answer. A child run is scripted too: it must start without the history, list the filtered surface with no `skill`, still be refused a tool outside that surface, save its document with the parent link and the description as its title, publish the five topics with the parent's identity, and take its model from the parent's table. A `--check` run fails when any of them drifts, so `pnpm check:plugins` catches it without a kernel and without a model.

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
- **A hook cannot change what a call does**: hooks refuse calls and add text to the turn, and never rewrite a tool's arguments or its output.
- **Everything a child does is the parent's as far as the rest of the deployment is concerned**: the gate, the audit file and the hooks see the parent's session id and call id, so nothing downstream can single a subagent out.
- **Nothing here bounds the depth**: this plugin runs whatever tool the pool holds, so one level of delegation is a property of the delegating tool's deny list rather than of this one.
- **A turn is saved before it starts**: an interrupted turn leaves the session with its trailing user message.
