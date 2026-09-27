---
description: "The memory group: the independent hook and tool plugin that keeps a fixed-budget, always visible working set."
kind: "package-group"
---

# memory/: model-maintained memory

English | [中文](README.zh.md)

## Summary

Memory is independent from request context. One plugin provides both `hook.memory` and `tool.memory`: the hook contributes a bounded memory snapshot before each model call, and the tool lets the model add, replace, or remove entries. The store is plain Markdown, bounded by character count, and never silently dropped when full.

## Table of Contents

- [Modules](#modules)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`memory`](memory/README.md) | The `hook.memory` provider and `tool.memory` tool. |

<a id="related-documentation"></a>
## Related documentation

- [context group](../context/README.md): provider separation.
- [hooks](../hooks/README.md): the `PreModel` event.
- [tools](../agent/tools/README.md): how the model tool is dispatched.