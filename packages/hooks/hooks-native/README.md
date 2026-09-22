---
description: "The hook engine: the hooks capability, how hook plugins are discovered, asked and merged, and what a failing hook costs."
kind: "package-reference"
---

# hooks-native

English | [中文](README.zh.md)

## Summary

The one place a hook plugin is discovered, asked and merged. It provides the `hooks` capability, finds every `hook.*` capability the kernel published and every command hook the profile listed, asks the ones that declared the event it was called about, and folds the answers with the rules of [`hook-protocol`](../hook-protocol/README.md). It sits between two parties that never meet: `agent-core` calls it at one point per event and gets a single merged answer, while a hook plugin is only ever reached through its own capability. Anything that goes wrong on either side is logged and treated as no opinion, so a hook can tighten a turn and can never break it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The methods

| Method | Params | Returns |
|---|---|---|
| `trigger` | `{ event, payload }` | The merged `HookOutcome`, as `hook-protocol` defines it. With no hook mounted this is `{}`, which every caller reads as no opinion. An `event` outside the twelve is a `-32602`. |
| `list` | none | `{ hooks, commands }`: one `{ capability, events }` per hook that answered `describe`, in name order, and one `{ event, command, scope, matcher? }` per command hook. For an operator asking what is actually mounted. |
| `register` | `{ scope, hooks }` | `{ registered, scope }`, replacing whatever that scope held. A run registers the command hooks it borrowed and takes them back under the same scope, so two runs registering the same command never withdraw each other. |
| `unregister` | `{ scope }` | `{ removed, scope }`. Removing a scope nobody registered is not an error. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_context_chars` | `4000` | The cap for one context entry. Each entry is clipped on its own, so twenty hooks may each contribute this much. |
| `command_hooks` | none | Command hooks the profile itself lists, each `{ event, matcher?, command, timeout_ms? }`. They are owned under a scope named `config` and fold by the same rules a plugin's answer does. |
| `parallel` | `true` | Whether the hooks that declared one event are asked at the same time. Answers are folded in name order either way. |
| `strict` | `true` | What a `hook.*` capability without a usable `describe` costs. True is a startup failure; false skips it with a warning. |

### Writing a hook

A hook is a plugin that provides a `hook.<name>` capability, answers `describe` with the events it implements, and implements one method per declared event. The payload each method receives, the fields it may answer with and the merge rules are owned by [hook-protocol](../hook-protocol/README.md#use-this-package); this package is the caller of that contract.

A command hook is the same contract without a plugin: a script the profile lists under `command_hooks`, or one a run registers for the length of that run. It is handed `{ event, payload }` as JSON on stdin, answers with one JSON object on stdout, and anything else counts as no opinion. Its `matcher` narrows it to tool names on the two tool events, its `timeout_ms` defaults to 10000, and every run of it leaves one line in `$MAOTA_HOME/audit/hooks.jsonl` whether it answered or not.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, discovery at `start`, the subscription that rebuilds it, the two methods and the self check. |
| [`src/engine.ts`](src/engine.ts) | `providerCapabilities`, `describeProviders` and `runHooks`: the parts that need a channel but not a plugin. |
| [`src/command.ts`](src/command.ts) | `CommandHook`, `runCommandHooks` and the audit trail: the part that runs a hook as a process. |

### Discovery

`providerCapabilities` keeps every capability name that starts with `hook.`, dropping the bare prefix, and sorts the rest. Each one is then asked `describe`, and a capability that cannot answer or declares no event this engine knows is logged and left out rather than called. The capability table is the only registry there is: nothing to register, nothing to unregister, and a hook that is mounted is a hook that is discovered.

The table handed to `start` is a snapshot, so the engine also subscribes to `kernel.capabilities.changed` and rebuilds its list from the table in the event payload. A hook that joins or leaves later is therefore noticed even though the engine started first; no row order in the profile is load bearing.

### Fan out and stamping

`collectHookContributions` walks the hooks in name order and asks the ones that declared this event, passing the payload straight through. Each answer is stamped with the hook that gave it, as `hook:<name>` with the capability prefix folded into the separator, so the context message a session ends up holding names a hook and not a plugin id. The default is to ask them at once, so a slow hook does not delay the ones behind it, and the answers are folded in name order either way; a hook that is asked the same event twice in a turn is called twice. A command hook is a process rather than a call, so it is always asked at once, and the two groups are asked at the same time and folded providers first.

### A failing hook has no opinion

A hook that throws, cannot be reached or times out contributes nothing, and `trigger` never throws because of it: the turn continues with the other hooks' answers. This is the deliberate direction, because the layers under the hooks already fail closed: the classification and the tool's own approval still run, so a hook that disappears can only fail to tighten a turn, never loosen one. The timeout is the kernel's own per provider `request_timeout_ms`; this package adds no timeout of its own, and a payload the engine cannot answer for is refused with `-32602` rather than guessed at.

### What is logged

Every discovery pass and every call is logged through the channel: one line naming the event and whether anything was refused or allowed, with the hooks that answered. A command hook is the one thing written down: one line per run in `$MAOTA_HOME/audit/hooks.jsonl`, holding the event, the scope, the command, the exit code and what it decided. Everything else stays in memory, so a plugin hook's effect is durable only through what it injects into a session.

### The self check

`selfCheck` runs without a kernel, against a fake channel: it covers the name filter and its order, `describe` being required, a hook declaring no event being skipped, a refusal beating an allowance, context accumulating and clipping, a failing hook not swallowing another hook's refusal, a changed capability table rebuilding the list, and an event outside the twelve being refused.

Five facts bound this engine. Its hooks are plugins with capabilities or commands the profile lists, so a hook that is neither has no way in. Nothing durable records what a plugin hook refused, because a decision is logged and then gone, while a command hook leaves one audit line whether it answered or not. A hook may rewrite the arguments of a call and what the model is told it returned, and nothing else about it. Hooks are asked at once by default, so the slowest hook in the list sets the pace of the whole point only while `parallel` is turned off. And a deployment whose capability table has no `hooks` turns every plugin hook off silently, which is logged once at start and nowhere else.

-----

<a id="further-exploration"></a>
## Further exploration

- [hook-protocol](../hook-protocol/README.md): the events, payloads and merge rules this engine applies.
- [agent-core](../../agent/agent-core/README.md): the bridge that calls `trigger` and maps the answer onto the loop's decisions.
- [agent-loop](../../agent/agent-loop/README.md): the seams the bridge is wired into.
- [hooks package](README.md): the group this engine belongs to.
- [the hook points](../../../docs/user/hooks.md): the twelve points in one turn, and the invariant behind the failure policy.
