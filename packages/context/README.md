---
description: "The context group: independent hook plugins that add model-visible context at PreModel."
kind: "package-group"
---

# context/: request context providers

English | [中文](README.zh.md)

## Summary

Context is not a registry. Each provider is an independent hook plugin that declares `PreModel` and contributes plain text through the existing hook engine. The engine stamps the source, and `agent-core` stores the result as durable user-role context. One provider sits here: agent instructions. Memory is separate because it also defines a model tool.

## Table of Contents

- [Modules](#modules)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`agent-instructions`](agent-instructions/README.md) | The `hook.agent-instructions` provider: it loads `AGENTS.md` and `CLAUDE.md`, applies a byte budget, and contributes them before each model call. |

<a id="related-documentation"></a>
## Related documentation

- [hooks](../hooks/README.md): the engine and the `PreModel` event.
- [memory](../memory/README.md): the model-maintained memory provider.
- [packages/, the plugin tree](../README.md): which plugin owns which capability.