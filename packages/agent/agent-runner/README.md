---
description: "The agent-runner package: the single turn entry, session serialization, queue priority, wake budget, and system-message delivery."
kind: "package-reference"
---

# agent-runner

English | [中文](README.zh.md)

## Summary

`agent.runner` is the single entry point for turns. It keeps one running turn per session, queues lower-priority system work behind user input, applies a consecutive wake budget, and publishes `agent.turn.*` events for scheduled work. Job completion notifications and cron reminders use the same delivery path.

Front ends do not drive `agent.loop` directly. The CLI, Web, jobs, and schedule call `agent.runner`; the runner queues and serializes the turn, then calls `agent.loop` to run the model and tool loop.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Methods

| Method | Parameters | Answer |
|---|---|---|
| `send` | `{ session_id, cwd, input, thinking?, source }` | A stream. Only `source.kind = "user"` is accepted. |
| `deliver` | `{ session_id, cwd, input, source, wake?, wait? }` | `{ turn_id, state }`, or the final turn result when `wait: true`. Accepts job and schedule sources. |
| `cancel` | `{ turn_id }` | `{ cancelled: true }`; queued and running turns can both be cancelled. |
| `status` | `{ session_id }` | `{ running, queued, deferred, wake_budget }`. |

### Sources

- `{ kind: "user" }`: user input, highest priority.
- `{ kind: "job", id }`: background job completion, middle priority.
- `{ kind: "schedule", id, occurrence, mode, title }`: reminder or scheduled result, lowest priority.

The source is persisted with the user message, so a front end can distinguish chat from system delivery.

### Events

| Event | Meaning |
|---|---|
| `agent.turn.queued` | The turn entered the queue. |
| `agent.turn.start` | The turn started running. |
| `agent.turn.text` | Model text. |
| `agent.turn.reasoning` | Model reasoning text. |
| `agent.turn.tool_call` | A tool call started. |
| `agent.turn.tool_result` | A tool call settled. |
| `agent.turn.done` | The turn completed. |
| `agent.turn.error` | The turn ended with an error. |

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `max_parallel_turns` | `2` | Maximum turns running across all sessions. |
| `max_system_turns` | `1` | Maximum system turns running across all sessions. |
| `max_consecutive_wakes` | `3` | Maximum consecutive system wakes for one session before new user input. |

### Requirements

| Capability | Required | Use |
|---|---|---|
| `agent.loop` | Yes | Runs the model and tool loop. |
| `jobs` | No | Supplies background job completion events. |
| `permission` | No | Sets a fresh session's task-level permission policy. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Capability definition, configuration, methods, event subscription, and self-check entry. |
| [`src/queue.ts`](src/queue.ts) | Session queues, priority, global concurrency, wake budget, and deferred inbox. |
| [`src/run.ts`](src/run.ts) | Converts a turn to `agent.loop.run`, relays stream events, and builds the final result. |
| [`src/sources.ts`](src/sources.ts) | Source parsing and job or schedule notification text. |
| [`src/types.ts`](src/types.ts) | TurnInput, TurnResult, TurnEvent, and source types. |

### Serialization and priority

One session runs at most one turn. Different sessions can run in parallel until the global limit is reached.

Priority is fixed:

1. User turns.
2. Job completion notifications.
3. Schedule reminders.

Equal priorities run FIFO. A running turn is never preempted by later user input.

### Busy and idle sessions

A job or schedule message that arrives during a user turn waits for that turn to finish. It is not inserted into the running model step.

An idle session receives a follow-up turn when a system message arrives and its wake budget is available.

### Wake budget

Each session has its own consecutive wake count. The default maximum is three. User input resets the budget. When the budget is exhausted, system messages remain deferred until user input or another explicit delivery opportunity.

This bounds a self-triggering chain: a completion wakes the agent, the agent starts more work, and that work completes again.

### System messages

A completed job notification carries the job id, kind, status, and label. The model reads output with `job_output`; it is told not to poll.

Schedule reminders use the fixed `[SCHEDULE REMINDER]` wrapper and JSON-encode the prompt. The prompt is marked as untrusted reminder content.

### Recursive schedule protection

When the source is a schedule, the runner denies `cron_create`, `cron_update`, `cron_delete`, and `cron_run_now` before calling `agent.loop`. Scheduled work can run, but it cannot create more schedules.

### Cancellation and shutdown

Cancellation aborts queued and running turns and propagates into `agent.loop`. Runner state is process-local; queued, deferred, and running turns do not survive host shutdown. Durable behavior belongs to schedule definitions and session documents.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-core](../agent-core/README.md): the low-level loop capability the runner calls.
- [jobs registry](../../jobs/jobs/README.md): background job state, output, and completion events.
- [schedule service](../../schedule/schedule/README.md): durable schedules, modes, and delivery.
- [maota CLI](../../../apps/cli/README.md): user-facing jobs and cron commands.