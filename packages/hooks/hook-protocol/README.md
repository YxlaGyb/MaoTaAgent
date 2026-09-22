---
description: "The hook dialect: the twelve events, the payload each carries, what a hook answers with, and how several answers fold into one, for a hook author or a bridge."
kind: "package-reference"
---

# hook-protocol

English | [中文](README.zh.md)

## Summary

The words a hook is written in, and the words an engine answers in. It holds one file and no dependency: the twelve event names, the payload each one carries, the reply a hook writes and the outcome several replies fold into, the `hook.*` provider contract, and the merge that decides whose answer wins. Nothing here knows about a loop, a session or a process, so the package can be imported by a hook plugin, by the engine that calls it, and by the bridge that hands the result on, without any of them importing each other.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The events

| Event | Payload | When the engine asks |
|---|---|---|
| `UserPromptSubmit` | `{ session_id, cwd, input }` | Before the prompt reaches the model, and before anything is written down. |
| `SessionStart` | `{ session_id, cwd, subagent }` | When a run begins, before the tools are listed. |
| `SessionEnd` | `{ session_id, cwd, subagent, steps, reason }` | When a run ends, whichever way it ended. |
| `PreToolUse` | `{ session_id, cwd, step, tool, args, call_id, subagent? }` | Before a tool call is dispatched, and before it is classified. `args` are the arguments the tool would receive, host arguments included. |
| `PostToolUse` | the pre-tool payload plus `{ ok, output }` | After the call settled, before its result is written back. |
| `PreModel` | `{ session_id, cwd, subagent, step }` | Before a model call is made. |
| `PostModel` | the pre-model payload plus `{ ok }` | After the model call settled, before the loop reads it. |
| `PreCompact` | `{ session_id, cwd, subagent, messages }` | Before a long conversation is folded, and only when a fold is about to happen. `messages` is how many are folded. |
| `SubagentStart` | `{ session_id, cwd, subagent_id, type, description }` | When a delegation begins, before its first model call. |
| `SubagentStop` | the subagent-start payload | When a delegation ends, whichever way it ended. |
| `Notification` | `{ session_id, cwd, text }` | When a run stops for a reason the model never got to say, so somebody can be told. |
| `Stop` | `{ session_id, cwd, steps, stop_active }` | When the model asked for no tool call, which is the moment a turn would end. |

`cwd` is `null` when the turn has no working directory. `call_id` is the id the model gave the call, so a reply can be matched to the call it is about.

On the two tool payloads, `subagent` is present only when a subagent made the call, and then it is `{ id, type, description }` and the `session_id` and `call_id` are its parent's. A hook therefore sees a child's call exactly where the session's own call would have been, and can tell the two apart if it needs to. On the session, model and compact payloads the same word is a boolean instead, saying that the run itself is a delegation; `SubagentStart` and `SubagentStop` are the ones that name it. Neither the prompt point nor the stop point fires for a subagent at all.

### What a hook answers with

One method per event, named after the event, taking that event's payload and returning a `HookReply` or `null` for no opinion.

| Field | Meaning |
|---|---|
| `decision` | `allow`, `deny` or `ask`. `deny` refuses: a refused prompt is never stored and never reaches the model, and a refused call is never dispatched and never classified. `allow` grants nothing on its own, because the classification and the tool's own approval still run. `ask` is a question rather than a verdict, and only the bridge that knows the permission layer can act on it. |
| `reason` | Why, when refusing or asking. Only the winner's reasons survive the merge, and they are what the model, or the person being asked, is told. |
| `args` | Replace the arguments of the tool call this event is about. The first hook that supplies them supplies them. |
| `context` | Text this hook wants injected into the conversation, one entry per message. Write plain text: the engine stamps the source on your behalf. |
| `output` | Replace what the model is told the call returned, on `PostToolUse`. The first hook that supplies one supplies it. |
| `preventContinuation` | After a tool call, ask for the turn to end. One hook asking is enough. |
| `steer` | On `Stop`, one more thing to say before the turn ends. The first hook that offers one supplies it. |

A hook that returns `null`, an empty object, or nothing at all has no opinion and does not affect the outcome.

### The provider contract

A hook is a plugin that provides a `hook.<name>` capability, where the name matches `^[a-z][a-z0-9._-]*$`.

| Method | Params | Answer |
|---|---|---|
| `describe` | none | `{ events }`: the events this hook implements, as `HookEvent[]`. Required. A `hook.*` capability without a usable `describe` is a startup failure for an engine in its default strict mode, and skipped with a warning otherwise. |
| one method per declared event | that event's payload | `HookReply` or `null`. |

`HOOK_EVENTS`, `isHookEvent`, `isHookCapability`, `HOOK_CAPABILITY_PREFIX` and `hookLabel` are the validation and labelling helpers around those names.

### Merging several answers

`mergeHookOutcomes(contributions, event, maxContextChars)` folds every reply into one `HookOutcome`, and the rules are about strictness rather than about order:

| Field | Rule |
|---|---|
| `decision` | A single `deny` beats any number of `ask`s and `allow`s, and a single `ask` beats any number of `allow`s. |
| `reason` | Only the reasons of whichever decision won are kept, joined by a blank line. A winning reply with no reason still says something. |
| `args` | The first hook that supplies replacement arguments supplies them. |
| `output` | The first hook that supplies a replacement output supplies it. |
| `context` | Every non-empty string of every reply, in hook order, clipped to `maxContextChars` and stamped with the hook it came from. An allowance's context is kept even when the outcome is a refusal. |
| `preventContinuation` | True when any reply asked for it. |
| `steer` | The first non-blank one. |

An outcome with no field set is the same as no hook being configured at all, and `clipContext(text, maxChars)` is the clipping the merge applies, exported for a caller that wants the same rule.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Everything: the events, the payloads, the reply and outcome shapes, the helpers and the merge. |

### Why the dialect lives here

An extension point belongs to the package that owns it, so the loop declares the decisions it consumes and no hook names, and the hook side owns the hook names and no loop. This package is what makes that possible: it is a leaf, so both sides may import it, and it is the only place where a field like `preventContinuation` is named. A bridge that maps a `HookOutcome` onto a loop decision writes that mapping in its own file.

### Merging is about strictness, not order

The fan out goes in capability order so the result is reproducible, but no field depends on that order: context accumulates in the order it was asked, `preventContinuation` is a true when any reply sets it, and a steer, a set of arguments or an output is taken from the first hook that offers one. The one field where a single hook can veto a crowd is `decision`, and that is deliberate: a refusal must never be diluted by others saying yes.

Four facts bound this dialect. It names twelve events, while the wider hook ecosystem names more, including two dozen this version does not carry, and adding one means adding it here first. A hook may replace the arguments a call runs with, and what the model is told that call returned, and nothing else about it. It may allow, refuse, or hand the question to a person, but it cannot answer for that person. And a hook reports nothing about what it decided beyond the context message that lands in a session, because decisions are durable only there.

-----

<a id="further-exploration"></a>
## Further exploration

- [hooks-native](../hooks-native/README.md): the engine that calls these hooks and folds their answers.
- [agent-core](../../agent/agent-core/README.md): the bridge that maps an outcome onto the loop's decisions.
- [hooks package](README.md): the group this dialect belongs to.
- [the hook points](../../../docs/user/hooks.md): where the twelve events sit in one turn.
