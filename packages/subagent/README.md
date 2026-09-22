---
description: "The subagent group: the tool that hands one sub-task to an agent with a context of its own, and the seams that keep what it did under the call that started it."
kind: "package-group"
---

# subagent/: delegation

English | [中文](README.zh.md)

## Summary

A large task reads better when it is cut into pieces that do not share a context. This group holds the one tool that cuts them: [`tool-subagent`](tool-subagent/README.md) declares the `tool.task` capability, which the `tools` dispatcher offers the model as `task`. One call hands over one sub-task and one final message comes back; everything else stays in the subagent's own session. The run belongs to `agent-core`, the child's record to `session`, and the identity its calls carry to `permission` and the hooks.

## Table of Contents

- [Modules](#modules)
- [One delegation, end to end](#one-delegation-end-to-end)
- [What a subagent cannot do](#what-a-subagent-cannot-do)
- [Related documentation](#related-documentation)

-----

<a id="modules"></a>
## Modules

| Directory | Role |
|---|---|
| [`tool-subagent`](tool-subagent/README.md) | The model's side of a delegation: the `task` capability, its two kinds of subagent, the tool surface each kind gets, the concurrency cap and the three shapes an answer can take. |

`tool-subagent` is discovered like any other tool: the kernel publishes its capability, the `tools` dispatcher lists what it finds, and `agent-core` injects the session id, the working directory and the id of the call as host arguments. The profile config spawns `@maota/tool-subagent`, built from `tool-subagent/src/index.ts`.

The tool holds no model and no files. Its one dependency is `agent.loop` at `^1.3`, because that is where a child run is actually made.

<a id="one-delegation-end-to-end"></a>
## One delegation, end to end

1. The model calls `task` with a `prompt`, a short `description` and a `subagent_type`.
2. `tool-subagent` refuses the call when too many subagents are already running, and otherwise makes a child session id and asks `agent.loop` for a sub-run: a fresh `messages[]`, the subagent's own system prompt, a filtered tool list, its own step ceiling, and an `origin` naming the parent session and the call.
3. The child run starts with no history, never gets the tool that would delegate again, and publishes `agent.subagent.*` events as it goes.
4. When it stops, it writes its own conversation to the session store, with the parent link that lets a front end hang it under the right call.
5. The caller gets the child's last message as the result of the `task` call, or a refusal, or a partial answer labelled as one.

Everything else about the run is left behind on purpose. A subagent is a way to spend context somewhere else, not a way to write to the parent's.

<a id="what-a-subagent-cannot-do"></a>
## What a subagent cannot do

- **It cannot delegate again.** `task` is denied to every subagent, whatever a deployment writes in `child_tools_deny`, and a hallucinated call to it is refused at the pre-tool seam like any other tool outside the surface.
- **It never sees the parent's conversation.** Its context is its own system prompt and the one prompt it was handed.
- **It cannot reach the skills list.** The `skill` tool is not offered to a subagent, so its prompt stays small.
- **It cannot outlive the call in the parent's history.** Only its final message comes back, and only as a tool result.

<a id="related-documentation"></a>
## Related documentation

- [tool-subagent](tool-subagent/README.md): the tool itself, its config, its refusals and its result shapes.
- [subagents](../../docs/user/subagent.md): the whole seam, including the child run, the parent link and the events.
- [agent-core](../agent/agent-core/README.md): the package that runs a child and owns the run parameters.
- [session](../session/README.md): the document a child is written to, and the parent link inside it.
- [Architecture](../../docs/architecture.md): the component map and the launch path.
