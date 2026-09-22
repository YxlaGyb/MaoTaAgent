---
description: "The hooks group: the package that owns the hook dialect, and the engine that lets a hook plugin have a say at the four points of one agent cycle."
kind: "package-group"
---

# hooks/: the hook tree

English | [中文](README.zh.md)

## Summary

The loop engine has three seams, and this group is what a deployment hangs on them: a hook plugin gets a say at four points of one agent cycle without the loop ever knowing that hooks exist. Two packages sit here. [`hook-protocol`](hook-protocol/README.md) owns the vocabulary: the four event names, the payload each one carries, what a hook answers with, and how several answers fold into one. It depends on nothing and is never spawned. [`hooks-native`](hooks-native/README.md) owns the engine: it discovers the `hook.*` capabilities the kernel published, asks them, merges what they said, and answers `agent-core` through the `hooks` capability. `agent-core` is the bridge and the only file that knows both vocabularies: it calls the engine, then translates the answer into the decisions the seams declared.

## Table of Contents

- [Modules](#modules)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`hook-protocol`](hook-protocol/README.md) | The dialect: `HOOK_EVENTS`, the four payload shapes, `HookReply`, `HookOutcome`, `mergeHookOutcomes` and the `hook.*` provider contract. It depends on nothing and is never spawned. |
| [`hooks-native`](hooks-native/README.md) | The engine: the `hooks` capability, discovery of `hook.*` capabilities, the fan out in name order, the stamping and the logging. |

The profile config spawns `@maota/hooks-native`, built from `hooks-native/src/index.ts`. `hook-protocol` is imported by the engine and by the bridge in `agent-core`, and is never spawned on its own. A hook author imports `hook-protocol` for its types and declares one `hook.<name>` capability; that capability is the whole registration, and there is no state to keep and no call to make.

<a id="related-documentation"></a>
## Related documentation

- [the hook points](../../docs/user/hooks.md): where the four events sit in one turn, and the invariant they may only tighten.
- [packages/, the plugin tree](../README.md): which plugin owns which capability.
- [agent package](../agent/README.md): the plugin whose seams these hooks hang on.
- [Architecture](../../docs/architecture.md): the component map and the launch path.
