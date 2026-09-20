---
description: "The agent package: the plugin that owns agent.loop and the loop engine it runs."
kind: "package-group"
---

# agent/: the agent plugin

English | [中文](README.zh.md)

## Summary

The `agent` plugin is the kernel plugin a user actually talks to: it turns one input plus a stored session into a model and tool loop, and streams the result back. Its parts are split here: the plugin side that reads config, builds the prompt and keeps the session; the loop engine that calls the model and runs tools; and the dispatcher those tools are listed and called through. Read this page to pick the right part, then open its directory.

## Table of Contents

- [Modules](#modules)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`agent-core`](agent-core/README.md) | The plugin: the `agent.loop` capability, its config keys, the system prompt, tool wiring, session bookkeeping and the streaming `run` method. |
| [`agent-loop`](agent-loop/README.md) | The loop engine: model call, tool round, exit reasons. It reads no config and touches no session. |
| [`tools`](tools/README.md) | The dispatcher: the `tools` capability, the tool registry, the result budget and the spill. |

The profile config spawns `@maota/agent-core`, built from `agent-core/src/index.ts`, and `@maota/tools`, built from `tools/src/index.ts`. `agent-loop` is imported by the agent entry and never spawned on its own.

<a id="related-documentation"></a>
## Related documentation

- [packages/, the plugin tree](../README.md): which plugin owns which capability.
- [Architecture](../../docs/architecture.md): the component map and the launch path.
