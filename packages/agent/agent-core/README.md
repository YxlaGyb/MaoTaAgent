---
description: "The Agent handle, live registry, process-local initiator scope, and agent/* and agent.subagent.* event vocabulary for plugins, UI, and orchestrators building or extending agents."
kind: "package-reference"
---

# agent

English | [中文](README.zh.md)

## Summary

`agent` is the plugin a front end actually talks to. One `run` call loads the history from `session`, prepends a system prompt built from the configured base and the working directory, appends a skill catalog note when that catalog differs from the last note the history carries, runs the model and tool loop, and saves the turn back. It provides the `agent.loop` capability, whose methods are `run` and `info`. The loop itself lives in [`../agent-loop`](../agent-loop/README.md); this directory owns the config, the prompt, the session bookkeeping and the tool wiring around it, and it is also the bridge between the loop and the hooks when an engine is mounted. The profile config spawns this package: `lib/index.js`, built from [`src/index.ts`](src/index.ts).

One input turns a `run` into the other kind of turn this package knows: an `origin` makes it a child run, the run a subagent is made of. A child starts from an empty conversation, keeps the identity of the session that spawned it, answers to a tool surface and a system prompt of its own, and reports its progress on the kernel's bus.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

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
| `system` | A system prompt that replaces the configured base for this run. The working directory and the approval policy are still appended, and the skill catalog never is. |
| `tools_allow` | The tool names this run may use. Absent means the whole pool. |
| `tools_deny` | The tool names to leave out, applied after `tools_allow`. |
| `max_steps` | How many model calls this run may make, over the configured `max_steps`. |
| `depth` | How many delegations deep this run is. Absent means a child is one deeper than the run that owns its parent session, and a top-level turn is 0. A run deeper than `max_depth` ends at once as `refused`. |

### A child run

The child differs from an ordinary turn in eight ways, and every one of them is visible to a caller:

| Property | Ordinary turn | Child run |
|---|---|---|
| History | Read from the session document. | Empty. The only input is `input`. |
| System prompt | The configured base, the working directory and the policy, plus a skill catalog note as a message of its own. | `system`, the working directory and the policy, and no catalog note. |
| Tools | The pool, which already holds `skill` when that row is mounted. | The pool filtered by `tools_allow`, `tools_deny` and the deny list the child was started with. |
| Session written | The turn's own session, titled from the first user message. | A document of its own, carrying the parent link and titled from `description`. |
| Model and level | The one `thinking` names. | The parent run's, from a table this plugin keeps per session while the parent runs. |
| Prompts | The turn's own points all fire: `UserPromptSubmit` before anything is written, `Stop` when the model asks for no more, and `SessionStart`, `PreModel`, `PostModel`, `PreCompact`, `Notification` and `SessionEnd` around the run. | `UserPromptSubmit` and `Stop` never fire, and the rest fire with `subagent: true`. |
| Tool hooks | The session's identity. | The parent's `session_id` and `call_id`, plus a `subagent` field. |
| Reporting | The caller's stream, and nothing else. | The caller's stream plus `agent.subagent.*` on the bus. |

The tool surface is filtered in two places on purpose: the child's listing is filtered, so the model never sees a name it may not use, and the pre-tool seam refuses everything outside it, so a name the model invented comes back as a refusal rather than running. The child's calls, questions and hook payloads all carry the parent's `session_id` and `call_id`, which is what lets a front end place a subagent's work under the tool row that started it.

An `origin` that is not an object, or whose `parent_session_id` is missing, is refused with `-32602`, as are a `system` that is not a string, a `tools_allow` or `tools_deny` that is not a list of strings, a `max_steps` that is not a positive integer, and a `depth` that is not a whole number of delegations. A child that names nothing but its parent gets the type `general`, no `parent_call_id` and an empty description.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `max_steps` | `8` | How many model calls one turn may make. |
| `max_parallel_tools` | `4` | How many safe tool calls one batch may run at once. |
| `compact_after_chars` | `120000` | When the text a turn would send passes this, the messages older than the newest `compact_keep_messages` are folded into one note. |
| `compact_keep_messages` | `12` | How many of the newest messages stay whole. |
| `max_depth` | `3` | How many delegations deep a run may be before it is refused. |
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

Every tool comes from `tools`, the `skill` tool included, because nothing here knows one tool from another by name. A tool that declares a host argument is given that value before the call, unless the model set the argument itself, and every host argument is stripped from the specs the model is shown. Safety is asked through `tools.classify`. A tool result that carries a `control` block is applied at the post-tool seam: the surface may be narrowed, the model may be replaced for the rest of the run, hooks may be registered for the rest of the run, and a body may be run as a child turn whose final text is what the call returns.

Four sources exist, `session_cwd`, `session_id`, `call_id` and `subagent`, so a tool knows which session it is serving, which call it is running and who is asking, and the model can claim none of them. In a child run the injected session and call id stay the parent's, and `subagent` carries the child's own id, type and description; a tool that declares that fourth source is told which subagent is asking, and every other tool behaves as it always did.

When a `permission` capability answers, the policy for this session is read once per turn and stated in the system prompt, so the model knows what a refusal means instead of retrying a command nobody will approve. Without that capability the prompt says nothing about approval, and the tools that would ask read the same absence as the mode that asks.

### Hooks

When a `hooks` capability answers, the turn is offered to the hooks at every point `hook-protocol` names: `UserPromptSubmit` before the messages are assembled; `SessionStart` once the run is allowed to begin; `PreModel` and `PostModel` around every model call, with `ok` saying how it went; `PreCompact` only when a fold is about to happen; the loop's two tool seams, `PreToolUse` before a call is classified and `PostToolUse` after one settled; `SubagentStart` and `SubagentStop` around a delegation; `Notification` when a run stops for a reason the model never got to say; `Stop` when the model asked for nothing more; and `SessionEnd` whichever way the run ends. This file is the only place that knows both vocabularies: it calls `hooks.trigger` once per point and maps the answer onto the decisions the loop declared, so the loop never hears a hook name and the hook packages never see a loop type. A decision of `ask` becomes a question for the approval layer, and a hook that supplies `args` or `output` replaces what the call runs with or what the model is told it returned. Context contributed at any of them becomes a `hook:<name>` message in the turn, so a point the loop has no seam for is still heard by the model, and so is the next turn when the point fires at the very end. A refused prompt is the one path that writes nothing, calls no model, and closes the stream as `done` with `steps` at 0 and `refused` as the reason. The capability is optional: a deployment without the engine simply has no hooks, which is logged once at start.

A child run reaches every one of those points but two: `UserPromptSubmit` and `Stop` do not fire for a child, because a subagent has no user turn of its own and takes no continuation instruction. Its calls carry the parent's `session_id` and `call_id` and a `subagent` field naming the child, and the session, model and compact points carry `subagent: true`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, `requires`, `run`, `info`, the hook bridge and `selfCheck` |
| [`src/catalog.ts`](src/catalog.ts) | The skill catalog note: when to append one and how it is compared with the last |
| [`src/compact.ts`](src/compact.ts) | Folding a long history into one note, and the note a step ceiling leaves behind |
| [`src/control.ts`](src/control.ts) | `readRunControl` and `narrow`: the `control` block a tool result may carry |
| [`src/prompt.ts`](src/prompt.ts) | `systemPrompt`: the base prompt and the working directory |
| [`src/tools.ts`](src/tools.ts) | `readToolList`, `stripHostArgs` and `injectHostArgs` with the host sources |

### One turn

`run` lists the tools, loads the stored session, appends the new input when it is not empty, appends the catalog note when the catalog differs from the last one the history carries, folds a history that has grown past `compact_after_chars`, and saves that history before the first model call, so a turn that dies mid flight still leaves a session behind. A fold replaces everything older than the newest `compact_keep_messages` messages with one note whose source is `{ kind: "compact", folded }`, written by a single non-streaming `chat` call, and a fold that cannot be written leaves the history alone rather than losing the turn. It then builds one message array, the system prompt first and the history after it, and runs the loop. When the loop returns, the same array without the system message is saved again together with the turn's title. A turn that reached `max_steps` stores a note saying so, so the next turn continues instead of starting over, and a model call that failed for good, after the gateway has spent the retries `@maota/api` owns, ends the run as `model_error` with what the turn already had still saved.

Before the session is even read, the prompt is offered to the hooks, and a refusal there ends the turn with nothing stored and no model call. Text a hook contributes lands in the array as a user message named `hook:<name>`: after the history and before the first step for a prompt, and right after the results it belongs to for a tool point.

Cancelling the request aborts the model call and any tool in flight, and the session keeps whatever was already appended. Beyond the loop's own seams, this plugin raises the events of `hook-protocol` around the run: `SessionStart` once the run is allowed to begin, `SessionEnd` whichever way it ends, `PreModel` and `PostModel` with `ok` around every model call, `PreCompact` only when a fold is about to happen, `SubagentStart` and `SubagentStop` around a delegation, and `Notification` when a run stops for a reason the model never got to say. Its stream also carries one thing the loop does not know about: a `tick` every 10 s while a turn is running.

A child run is the same path with four differences: it reads no history and is sent no catalog note, it writes to a session document of its own that carries the parent link and the description as its title, it publishes the `agent.subagent.*` topics around the run, and it takes the model and the thinking level from the parent run's entry in a process-level table, written when the parent starts and cleared when it ends. A child whose parent is not in that table falls back to the level that grants the tools and names no model, the same fallback as a run with no level at all.

### Config checks

`selfCheck` covers the pure parts of this directory: the thinking-level reader, the title cutter, host-argument injection and stripping, `readToolList`, one scripted run that must end `completed`, and one that must end `max_steps`. The hook bridge is checked there as well: the mappings keep only the fields their seam consumes, an empty answer counts as no opinion, a post-tool refusal ends the round and carries its reason, replacement arguments and a replacement output are passed through, `ask` becomes a question for the approval layer, and an engine that is absent or that fails comes back as an empty answer. A child run is scripted too: it must start without the history, list the filtered surface without `skill`, still be refused a tool outside that surface, save its document with the parent link and the description as its title, publish the five topics with the parent's identity, and take its model from the parent's table. The control channel is scripted too: a `control` block narrows the surface, replaces the model and registers hooks, and those hooks are withdrawn when the run ends. Folding is scripted as well: a history over the budget is stored as one note with the newest messages kept whole, a turn that reaches its ceiling stores the note that says so, a model call that throws ends the run as `model_error` with the turn still saved, and a run past `max_depth` is refused before it lists a tool. A `--check` run fails when any of them drifts, so `pnpm check:plugins` catches it without a kernel and without a model.

Three facts bound this plugin. It never picks a model: the thinking level supplies a name and the gateway holds the mapping. A hook may refuse a call, answer `ask` to hand the question to the approval layer, replace the arguments a call runs with and what the model is told it returned, and add text to the turn; narrowing the tool surface and the model beyond that is what the run-level `control` block is for. And a turn is saved before it starts, so an interrupted turn leaves the session with its trailing user message.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-loop](../agent-loop/README.md): the loop engine this plugin runs.
- [agent package](../README.md): how the plugin and the loop divide the work.
- [packages group](../../README.md): the plugin tree and which plugin owns which capability.
- [maota CLI](../../../apps/cli/README.md): the front end that drives `agent.loop`.
