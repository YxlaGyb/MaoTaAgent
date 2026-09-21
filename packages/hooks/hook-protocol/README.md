---
description: "The hook dialect: the four events, the payload each carries, what a hook answers with, and how several answers fold into one, for a hook author or a bridge."
kind: "package-reference"
---

# hook-protocol

English | [中文](README.zh.md)

## Summary

The words a hook is written in, and the words an engine answers in. It holds one file and no dependency: the four event names, the payload each one carries, the reply a hook writes and the outcome several replies fold into, the `hook.*` provider contract, and the merge that decides whose answer wins. Nothing here knows about a loop, a session or a process, so the package can be imported by a hook plugin, by the engine that calls it, and by the bridge that hands the result on, without any of them importing each other.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### The four events

| Event | Payload | When the engine asks |
|---|---|---|
| `UserPromptSubmit` | `{ session_id, cwd, input }` | Before the prompt reaches the model, and before anything is written down. |
| `PreToolUse` | `{ session_id, cwd, step, tool, args, call_id }` | Before a tool call is dispatched, and before it is classified. `args` are the arguments the tool would receive, host arguments included. |
| `PostToolUse` | the pre-tool payload plus `{ ok, output }` | After the call settled, before its result is written back. |
| `Stop` | `{ session_id, cwd, steps, stop_active }` | When the model asked for no tool call, which is the moment a turn would end. |

`cwd` is `null` when the turn has no working directory. `call_id` is the id the model gave the call, so a reply can be matched to the call it is about.

### What a hook answers with

One method per event, named after the event, taking that event's payload and returning a `HookReply` or `null` for no opinion.

| Field | Meaning |
|---|---|
| `decision` | `allow` or `deny`. `deny` refuses: a refused prompt is never stored and never reaches the model, and a refused call is never dispatched and never classified. `allow` grants nothing on its own, because the classification and the tool's own approval still run. |
| `reason` | Why, when refusing. Only the refusals' reasons survive the merge, and they are what the model is told. |
| `context` | Text this hook wants injected into the conversation, one entry per message. Write plain text: the engine stamps the source on your behalf. |
| `preventContinuation` | After a tool call, ask for the turn to end. One hook asking is enough. |
| `steer` | On `Stop`, one more thing to say before the turn ends. The first hook that offers one supplies it. |

A hook that returns `null`, an empty object, or nothing at all has no opinion and does not affect the outcome.

### The provider contract

A hook is a plugin that provides a `hook.<name>` capability, where the name matches `^[a-z][a-z0-9._-]*$`.

| Method | Params | Answer |
|---|---|---|
| `describe` | none | `{ events }`: the events this hook implements, as `HookEvent[]`. Required. A `hook.*` capability without a usable `describe` is skipped with a warning rather than called. |
| one method per declared event | that event's payload | `HookReply` or `null`. |

`HOOK_EVENTS`, `isHookEvent`, `isHookCapability`, `HOOK_CAPABILITY_PREFIX` and `hookLabel` are the validation and labelling helpers around those names.

### Merging several answers

`mergeHookOutcomes(contributions, event, maxContextChars)` folds every reply into one `HookOutcome`, and the rules are about strictness rather than about order:

| Field | Rule |
|---|---|
| `decision` | A single `deny` beats any number of `allow`s. |
| `reason` | Only the refusals' reasons are kept, joined by a blank line. A refusal with no reason still says something. |
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

The fan out goes in capability order so the result is reproducible, but no field depends on that order: context accumulates in the order it was asked, `preventContinuation` is a true when any reply sets it, and a steer is taken from the first hook that offers one. The one field where a single hook can veto a crowd is `decision`, and that is deliberate: a refusal must never be diluted by others saying yes.

-----

<a id="further-exploration"></a>
## Further exploration

- [hooks-native](../hooks-native/README.md): the engine that calls these hooks and folds their answers.
- [agent-core](../../agent/agent-core/README.md): the bridge that maps an outcome onto the loop's decisions.
- [hooks package](README.md): the group this dialect belongs to.
- [the hook points](../../../docs/hooks.md): where the four events sit in one turn.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Four events**: the wider hook ecosystem names more, including two dozen this version does not carry. Adding one means adding it here first.
- **No input rewriting**: a hook decides whether a call runs, and never changes the arguments it runs with.
- **No `ask` decision**: a hook may allow or refuse, never hand the question to a person.
- **A shutdown leaves no trace in the type**: a hook reports nothing about what it decided, because decisions are durable only in the session a context message lands in.
