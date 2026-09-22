---
description: "The subagent tool: the task the model hands to an agent with a context of its own, the two kinds of subagent it can ask for, the tool surface each kind gets, the cap on how many run at once, and the three shapes an answer can take."
kind: "package-reference"
---

# tool-subagent

English | [中文](README.zh.md)

## Summary

One capability, `tool.task`, offered to the model as `task`. A call hands one self-contained piece of work to a subagent and one final message comes back: the subagent gets a fresh context, its own tools and its own step ceiling, and the rest of the run stays out of the caller's history. Concurrency is `always`, so several `task` calls in one step may run side by side, and the plugin itself holds the cap on how many. The tool declares no `maxResultChars`, so the `tools` dispatcher spills a long answer to a file like any other long result.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### `task`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | Yes | The whole sub-task: the goal, where to start, and what to hand back. The subagent has not seen this conversation, so anything it needs must be in here. |
| `description` | string | Yes | A short label for the sub-task. It becomes the child session's title and the text a front end shows next to the call. |
| `subagent_type` | string | No | `general` or `explore`; `general` when it is left out. |
| `session_id` | string | Host | The session this call belongs to. Injected, never published. |
| `cwd` | string | Host | The session working directory. Injected, never published. |
| `call_id` | string | Host | The id of this call, so the child's work can be shown under it. Injected, never published. |

| `subagent_type` | Tools it works with | System prompt |
|---|---|---|
| `general` | Every tool the pool lists, minus `task` and minus `child_tools_deny`. | `general_system` |
| `explore` | Only `explore_tools`, minus the same denials. | `explore_system` |

Neither kind is given the `skill` tool, because that is the `child_tools_deny` default: a subagent's prompt stays small, and it is not there to expand it.

### What comes back

One string, in one of three shapes.

| Shape | When |
|---|---|
| The child's last message, trimmed | The run ended `completed`. |
| That message, followed by a paragraph saying it stopped at its step limit | The run ended `max_steps`. The child still worked, so the answer is handed over as a part of one. |
| `the subagent finished without a final message` | The run completed with no text at all. |

Everything else becomes a thrown error, which the loop turns into a failed tool result: the cap, a child that broke, and a cancelled child.

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_concurrent` | `4` | How many subagents this process may have in flight at once. |
| `child_max_steps` | `8` | The step ceiling handed to each child run. |
| `child_tools_deny` | `["skill"]` | Tool names no subagent may use. `task` is always denied and cannot be taken off the list, and a deployment that wants the `skill` tool inside a subagent writes `[]` to take it out of this default. |
| `explore_tools` | `["read", "glob", "grep"]` | What an `explore` subagent may use. |
| `general_system` | the packaged prompt | The system prompt a `general` child runs under. |
| `explore_system` | the packaged prompt | The system prompt an `explore` child runs under. |

### Refusals

| Refusal | Code | When |
|---|---|---|
| `prompt must be a non-empty string` | `-32602` | The prompt is missing, not a string or blank. |
| `description must be a non-empty string` | `-32602` | The label is missing, not a string or blank. |
| `subagent_type must be one of general, explore, got …` | `-32602` | The type is neither of the two. |
| `N subagents are already running, which is the cap, so this call was refused before it started: wait for one of them to finish, or do the work here instead, and do not retry it right away` | `-32019` | The cap is reached. The wording is aimed at the model: retrying at once only reaches the cap again. |
| `the <type> subagent failed before it answered: …` | `-32603` | The child run threw, or ended without a result. |
| `the <type> subagent was cancelled` | `-32013` | The parent turn was cancelled while the child was running. |

The cap counts subagents in flight, so a refused call never starts one and a finished one frees its seat immediately. The count lives in this plugin because this plugin is the only place that knows which calls are subagents: the loop knows only that a tool declared `concurrency: always`.

------

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the settings, the concurrency gate, the child run and `selfCheck`. |
| [`src/task.ts`](src/task.ts) | `readSubagentType`, `childPlan`, `childId`, the two packaged prompts and the sentence builders. |

### One call

`run` reads its three arguments, refuses when the cap is reached, and makes a child session id, `sub-` followed by twelve hexadecimal characters. It then asks `agent.loop` for a run in streaming mode with the child's own session id and working directory, the `origin` describing the parent session and this call, the plan's `system`, `tools_allow` and `tools_deny`, and `child_max_steps` as `max_steps`. The stream is read to its end; the last `done` event is the answer.

The seat is taken before the sub-run is asked for and released in a `finally`, so a child that throws, is cancelled or is refused by the loop still frees it.

### Why the child's tools are two filters, not one

The tool surface a child gets is enforced by `agent-core`, not here: this plugin only hands over `tools_allow` and `tools_deny`. That is deliberate: a filter that only hid tools from the list would leave a hallucinated call to run, so the child run also decides again at the pre-tool seam and answers a call outside the surface with a blocked result. This package's part is the plan, and the plan always includes `task`.

### Why `concurrency` is `always` and why there is no `maxResultChars`

Two `task` calls in one step are the point of the tool, and the loop already gathers every `always` tool in a step into batches of `max_parallel_tools`, so nothing in the loop has to change for them to run side by side. The cap is `max_concurrent` in this plugin, because only this plugin can see the whole picture.

The result of a `task` call is a summary of somebody else's work and can be long. Rather than cut it here, the tool leaves the ceiling unset and lets the `tools` dispatcher's own spill write an oversized result to a file and hand the model the path.

------
Seven facts bound a delegation. One level is all there is: a subagent cannot delegate, and nothing about the depth is configurable. There is no resume and no background run: the caller waits for the child, and the child's session id is not handed back, so a later turn cannot continue that conversation. A subagent's prompt comes from this plugin's config rather than from a file per agent. Every child starts empty, so a subagent that needs the parent's context must be given it in `prompt`. The answer is text, so a caller that wants a shape asks for the shape in words. A child is bounded by `child_max_steps` and by the parent turn's cancellation and by nothing else. And the cap is per process, which is the honest reading of in flight, though it means a deployment cannot reserve seats per session.


<a id="further-exploration"></a>
## Further exploration

- [subagent group](../README.md): the group this tool belongs to.
- [subagents](../../../docs/user/subagent.md): the child run, the parent link, the events and the identity a child's calls carry.
- [agent-core](../../agent/agent-core/README.md): the package that runs the child and enforces its tool surface.
- [tools](../../agent/tools/README.md): the dispatcher that lists this capability, injects the host arguments and spills a long result.

------
