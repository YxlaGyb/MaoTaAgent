---
description: "The todo group: the one package that gives the model a task list it keeps, and the session document the list is written into."
kind: "package-group"
---

# todo/: the plan tree

English | [中文](README.zh.md)

## Summary

A plan the model writes down is worth more than one it remembers. This group holds that list. One package sits here: [`tool-todo`](tool-todo/README.md) declares the `tool.todo_write` capability, which the `tools` dispatcher offers the model as `todo_write`. The tool keeps no state of its own: it checks the list the model wrote, hands it to the `session` capability, and answers with a count. The plan itself lives in the session document, so it outlives the tool call, the plugin process and the turn.

## Table of Contents

- [Modules](#modules)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`tool-todo`](tool-todo/README.md) | The model's side of the plan: the `tool.todo_write` capability, the item shape it accepts, the ceilings it refuses at, and the verification nudge it adds to its answer. |

`tool-todo` is discovered like any other tool: the kernel publishes its capability, the `tools` dispatcher lists what it finds, and `agent-core` injects the session id and the working directory as host arguments. The profile config spawns `@maota/tool-todo`, built from `tool-todo/src/index.ts`.

Nothing in this group stores a plan. The list is written into the session document through the `session` capability, which owns the projection a reader asks for and the file it is kept in.

<a id="related-documentation"></a>
## Related documentation

- [tool-todo](tool-todo/README.md): the tool itself, its config and its refusals.
- [session](../session/README.md): the capability that keeps the plan, and the document it lives in.
- [tools](../agent/tools/README.md): the dispatcher that lists the capability and calls it.
- [packages/, the plugin tree](../README.md): which plugin owns which capability.
- [Architecture](../../docs/architecture.md): the component map and the launch path.
