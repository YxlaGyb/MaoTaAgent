# Subagents

English | [中文](subagent.zh.md)

MaoTa works on one conversation at a time, and a conversation is a poor place to hold everything at once: context that runs out, work that is easier to read apart, and a reader who only wants the conclusion. A subagent is the answer to that: a second run, with a context of its own, whose entire contribution to the conversation is the message it ends with. This document owns that seam: what a subagent is, what it may do, what identity it wears, and what a front end may show.

## Table of Contents

- [The two sides of a delegation](#the-two-sides-of-a-delegation)
- [The two kinds of subagent](#the-two-kinds-of-subagent)
- [The child run](#the-child-run)
- [The tool surface, enforced twice](#the-tool-surface-enforced-twice)
- [Identity](#identity)
- [The parent link](#the-parent-link)
- [The events and the front ends](#the-events-and-the-front-ends)
- [What this does not cover](#what-this-does-not-cover)
- [Related documentation](#related-documentation)

-----

<a id="the-two-sides-of-a-delegation"></a>
## The two sides of a delegation

Two packages own the two halves, and neither imports the other.

`@maota/tool-subagent` owns the request: the `task` tool the model calls, the two kinds of subagent it may ask for, the tool surface and system prompt each kind gets, the cap on how many are in flight, and the shape of the answer. `@maota/agent-core` owns the run: `agent.loop` grew a sub-run mode (`origin`, `system`, `tools_allow`, `tools_deny`, `max_steps`), and that mode is what makes a child a child.

The split keeps the static dependency graph acyclic. `tool-subagent` requires `agent.loop` at `^1.3` and calls it; `agent-core` knows nothing about the delegating tool and discovers it the way it discovers every other tool, through `tools.list`. A deployment that never mounts `tool-subagent` simply has no `task` tool, and a deployment that mounts it without `agent-core` fails its `requires`.

<a id="the-two-kinds-of-subagent"></a>
## The two kinds of subagent

| `subagent_type` | Tools | System prompt | For |
|---|---|---|---|
| `general` | The whole pool, minus `task`, minus `child_tools_deny` | `general_system` | Work: searching, editing, running commands, reporting back. |
| `explore` | `explore_tools`, minus the same denials | `explore_system` | Looking around: reading what is there and answering with the paths that prove it. |

`explore` is the one that makes the read-only promise structural rather than a matter of the prompt: its tool list is a fixed whitelist, so there is nothing to talk it out of. Both kinds are denied `task`, whatever a deployment writes in `child_tools_deny`, because one level of delegation is the whole shape of this version.

Neither kind is offered the `skill` tool and neither is sent a skill catalog, which is the `child_tools_deny` default. A subagent has its own context to spend, and a catalog would spend it before the work started.

<a id="the-child-run"></a>
## The child run

A child run is a run of `agent.loop`, so it reuses the loop, the provider, the tool dispatcher and the session store. What it changes is this:

| Property | Ordinary run | Child run |
|---|---|---|
| History | Loaded from the session document. | Empty, always. The only input is the prompt. |
| System prompt | The configured one, the working directory and the approval policy, and a skill catalog arrives as a message of its own. | The subagent's own, plus the working directory and the approval policy, and no catalog message. |
| Title | The first user message. | The call's `description`. |
| Step ceiling | `max_steps`. | The `child_max_steps` the call was given. |
| Model and thinking level | Read from the level the caller picked. | Inherited from the parent run, which published them when it started. |
| Prompts | `UserPromptSubmit` fires, and `Stop` when the run ends. | Neither fires: a subagent has no user turn and does not take continuation instructions. |
| Hooks | `PreToolUse` and `PostToolUse` with the session's own identity. | The same hooks, carrying the parent's session and call id plus a `subagent` field. |

The inheritance of the model and thinking level is worth naming: a child asks the provider for the same model its parent used, and a subagent started under a `medium` level does not silently run on the default. The lookup is a process-level table keyed by session id, written when the parent run starts and removed when it ends, and a child whose parent is not found falls back to the level that gets the tools and no explicit model.

Everything the child does with a tool happens as a normal tool call in the child's own session. Nothing of it is copied into the parent: the parent's history holds the `task` call and its one result, and that is the entire trace.

<a id="the-tool-surface-enforced-twice"></a>
## The tool surface, enforced twice

A child's tools are filtered in two places, and both matter.

The list the model sees is filtered, so a `general` child in a deployment that denies `write` is not told the tool exists. And the pre-tool seam checks the surface first, before anything else gets an opinion, so a call the model imagined anyway comes back as a blocked result reading `the <name> tool is not available to this subagent`. That second check is the one that turns a promise into a property: a prompt-injected or hallucinated call cannot reach a tool outside the surface, whether or not the model was ever shown it.

The surface is applied to the child by `agent-core`, not by the delegating tool, because the run is the only place where a call can be stopped.

<a id="identity"></a>
## Identity

A tool call inside a subagent speaks to the rest of the system as the parent session's call, with a note saying who is really asking. Concretely, for a `pwsh` call a subagent made while the user watches the `task` row:

| Field | Value |
|---|---|
| `session_id` | The parent's session. |
| `call_id` | The id of the parent's `task` call. |
| `tool` | The tool the subagent actually called (`pwsh`). |
| `subagent` | `{ id, type, description }` of the child. |

`permission/request` takes that optional `subagent`, the audit file records it on both the `asked` and the `decided` record, and the two published events carry it. The web plugin forwards it on the approval card, which is why a question asked by a subagent appears under the parent's `task` row and says which subagent is asking. The `PreToolUse` and `PostToolUse` hook payloads carry the parent identity and the same field.

The point of the scheme is that a front end needs exactly one anchor, `call_id`, to place anything: a tool call, an approval card, a subagent's tool traffic. That anchor already existed for the parent's own calls, so subagents did not need a second way of placing things.

<a id="the-parent-link"></a>
## The parent link

The `session` capability is at version `1.2.0` and its document schema at version 3. A child's document is stored beside its parent's, in the same directory, because a child is handed the parent's working directory and never writes outside it. It carries one extra field:

```json
{
  "parent": {
    "id": "the parent session id",
    "cwd": "the parent working directory",
    "call_id": "the id of the task call",
    "type": "explore",
    "description": "look at the loader"
  }
}
```

That field changes three answers. `session.list` leaves linked documents out, so the sidebar and the chat search never see a subagent. `session.children { id, cwd }` returns the subagents one session started, in the order they were created. And every summary in either answer carries the link, so a page that reopens an old session can rebuild the entry under the right call without loading anything.

Reading a document written by version 1 or 2 still works: it upgrades on read, with no link, and the next write stores version 3.

<a id="the-events-and-the-front-ends"></a>
## The events and the front ends

Five topics are published on the kernel's bus, best effort, while a child runs:

| Topic | Payload, beyond the five identity fields |
|---|---|
| `agent.subagent.started` | nothing |
| `agent.subagent.step` | `step` |
| `agent.subagent.tool_call` | `id`, `tool`, `args` |
| `agent.subagent.tool_result` | `id`, `tool`, `ok`, `output` |
| `agent.subagent.finished` | `steps`, `reason`, `ok` |

Every payload also carries `subagent_id`, `parent_session_id`, `parent_call_id`, `type` and `description`. Nothing else about the child is published: its text and its reasoning stream inside its own run and are not broadcast, because a page that already shows the parent's tokens has no use for the child's.

These events are how a live view follows a subagent, and they are also the part that costs nothing when it is lost. What a subagent contributed is the result of the `task` call, which arrives on the parent's own stream; the events only say what happened while a reader was watching. A front end that misses them shows less, and shows something correct.

The web plugin subscribes to `agent.subagent.*` and forwards each one as `subagent.<name>` with the `turn_id` of the parent session's current round, which is the only key the page uses. An event that arrives when no round is running for that session is dropped. The page renders a subagent under the tool row whose `call_id` matches, with its type, its label, its status, its step count and the tools it called, and offers to load the child's own session on demand; reopening an old session rebuilds the same entry from `session.children`.

The CLI subscribes to the same topics and prints them indented, so a terminal shows a subagent's calls without changing the shape of the parent's own output.

<a id="what-this-does-not-cover"></a>
## What this does not cover

- **No waiting in the background.** A `task` call blocks until the child stops. There is no handle to poll and no way to start one and come back later.
- **No resume.** The child's session id is not returned to the model, so no later turn can continue that conversation.
- **No agent definition files.** Prompts come from the plugin's config, not from a file per agent.
- **No fork.** Every child starts empty; the parent's conversation is not copied.
- **No structured output.** A result is text.
- **No timeout of its own.** A child is bounded by its step ceiling and by the parent turn's cancellation.
- **No out-of-process backend.** A child runs in the same plugin process as its parent; there is no remote worker.

<a id="related-documentation"></a>
## Related documentation

- [subagent package group](../../packages/subagent/README.md): the delegating tool and how it is mounted.
- [tool-subagent](../../packages/subagent/tool-subagent/README.md): the tool's parameters, config, refusals and result shapes.
- [agent-core](../../packages/agent/agent-core/README.md): the run a child is made of.
- [session](../../packages/session/README.md): the document and the parent link.
- [the permission gate](permission.md): the file and the events the `subagent` field lands in.
- [the hook points](hooks.md): the two seams a child's calls pass through.
- [architecture](../architecture.md): where all of this sits in the whole system.
