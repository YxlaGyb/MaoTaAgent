---
description: "The hook engine: the hooks capability, how hook plugins are discovered, asked and merged, and what a failing hook costs."
kind: "package-reference"
---

# hooks-native

English | [中文](README.zh.md)

## Summary

The one place a hook plugin is discovered, asked and merged. It provides the `hooks` capability, finds every `hook.*` capability the kernel published, asks the ones that declared the event it was called about, and folds the answers with the rules of [`hook-protocol`](../hook-protocol/README.md). It sits between two parties that never meet: `agent-core` calls it at one point per event and gets a single merged answer, while a hook plugin is only ever reached through its own capability. Anything that goes wrong on either side is logged and treated as no opinion, so a hook can tighten a turn and can never break it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### The methods

| Method | Params | Returns |
|---|---|---|
| `trigger` | `{ event, payload }` | The merged `HookOutcome`, as `hook-protocol` defines it. With no hook mounted this is `{}`, which every caller reads as no opinion. An `event` outside the four is a `-32602`. |
| `list` | none | `{ hooks }`, one entry per hook that answered `describe`: `{ capability, events }`, in name order. For an operator asking what is actually mounted. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_context_chars` | `4000` | The cap for one context entry. Each entry is clipped on its own, so twenty hooks may each contribute this much. |

### Writing a hook

A hook is a plugin that provides a `hook.<name>` capability, answers `describe` with the events it implements, and implements one method per declared event. The payload each method receives, the fields it may answer with and the merge rules are owned by [hook-protocol](../hook-protocol/README.md#use-this-package); this package is the caller of that contract.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, discovery at `start`, the subscription that rebuilds it, the two methods and the self check. |
| [`src/engine.ts`](src/engine.ts) | `providerCapabilities`, `describeProviders` and `runHooks`: the parts that need a channel but not a plugin. |

### Discovery

`providerCapabilities` keeps every capability name that starts with `hook.`, dropping the bare prefix, and sorts the rest. Each one is then asked `describe`, and a capability that cannot answer or declares no event this engine knows is logged and left out rather than called. The capability table is the only registry there is: nothing to register, nothing to unregister, and a hook that is mounted is a hook that is discovered.

The table handed to `start` is a snapshot, so the engine also subscribes to `kernel.capabilities.changed` and rebuilds its list from the table in the event payload. A hook that joins or leaves later is therefore noticed even though the engine started first; no row order in the profile is load bearing.

### Fan out and stamping

`runHooks` walks the hooks in name order and calls the ones that declared this event, one at a time, passing the payload straight through. Each answer is stamped with the hook that gave it, as `hook:<name>` with the capability prefix folded into the separator, so the context message a session ends up holding names a hook and not a plugin id. Requests are sequential, so a hook that answers slowly delays the ones behind it, and a hook that is asked the same event twice in a turn is called twice.

### A failing hook has no opinion

A hook that throws, cannot be reached or times out contributes nothing, and `trigger` never throws because of it: the turn continues with the other hooks' answers. This is the deliberate direction, because the layers under the hooks already fail closed: the classification and the tool's own approval still run, so a hook that disappears can only fail to tighten a turn, never loosen one. The timeout is the kernel's own per provider `request_timeout_ms`; this package adds no timeout of its own, and a payload the engine cannot answer for is refused with `-32602` rather than guessed at.

### What is logged

Every discovery pass and every call is logged through the channel: one line naming the event and whether anything was refused or allowed, with the hooks that answered. Nothing is written to disk, so a hook's effect is durable only through what it injects into a session.

### The self check

`selfCheck` runs without a kernel, against a fake channel: it covers the name filter and its order, `describe` being required, a hook declaring no event being skipped, a refusal beating an allowance, context accumulating and clipping, a failing hook not swallowing another hook's refusal, a changed capability table rebuilding the list, and an event outside the four being refused.

-----

<a id="further-exploration"></a>
## Further exploration

- [hook-protocol](../hook-protocol/README.md): the events, payloads and merge rules this engine applies.
- [agent-core](../../agent/agent-core/README.md): the bridge that calls `trigger` and maps the answer onto the loop's decisions.
- [agent-loop](../../agent/agent-loop/README.md): the seams the bridge is wired into.
- [hooks package](README.md): the group this engine belongs to.
- [the hook points](../../../docs/user/hooks.md): the four points in one turn, and the invariant behind the failure policy.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No command hooks**: hooks are plugins with capabilities, never an external command line or a `hooks.json` file, so a hook that is not a plugin has no way in.
- **No audit trail**: a decision is logged and then gone; nothing durable records what a hook refused.
- **No tool rewriting**: a hook decides whether a call runs, not what it runs with, so there is no argument or output rewriting.
- **Sequential fan out**: hooks are asked one after another, so the slowest hook in the list sets the pace of the whole point.
- **One honest gap on an absent engine**: a deployment without `hooks` in the capability table turns every hook off silently, which is logged once at start and nowhere else.
