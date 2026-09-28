---
description: "The schedule service: durable definitions, time selectors, execution modes, permissions, recovery, and bounded history."
kind: "package-reference"
---

# schedule service

English | [中文](README.zh.md)

## Summary

The service stores schedules in `$MAOTA_HOME/schedules.json`. It supports `remind`, fresh-session `agent`, and no-LLM `script` runs, dispatches at most one missed occurrence after restart, and writes bounded run history.

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
| `create` | schedule fields | Stored record. |
| `list` | none | `{ schedules }`. |
| `update` | id and changed fields | Updated record. |
| `delete` | `{ id }` | `{ id, deleted }`. |
| `run_now` | `{ id }` | Run record. |
| `history` | `{ id, limit? }` | Newest run records. |

### Time selectors

| Selector | Meaning |
|---|---|
| `after_seconds` | One-shot delay from creation or the last anchor update. |
| `at` | One-shot absolute RFC3339 instant. |
| `every_seconds` | Fixed interval anchored to creation or the last timing update. |
| `daily` | Local wall-clock time in an explicit IANA timezone. |
| `weekly` | Local time plus ISO weekdays in an explicit IANA timezone. |
| `cron` | Five-field Vixie expression in an explicit IANA timezone. |

The cron dialect supports `*`, single values, ranges, steps, and comma lists. It rejects seconds, `L`, `W`, `#`, and month or weekday names.

### Modes

| Mode | Behavior |
|---|---|
| `remind` | Delivers a reminder to the source session. Permission policy is inherited. |
| `agent` | Runs a self-contained prompt in a fresh session with a stored permission policy. |
| `script` | Runs a file below `$MAOTA_HOME/scripts` with an argument array and no shell interpolation. |

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `max_parallel_runs` | `2` | Maximum concurrent scheduled runs. |

Run history keeps at most 200 records per task and 30 days of files.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Service definition, scheduler loop, persistence, and methods. |
| [`src/clock.ts`](src/clock.ts) | Selector validation and next-occurrence calculation. |
| [`src/execution.ts`](src/execution.ts) | Reminder, agent, and script execution. |
| [`src/store.ts`](src/store.ts) | Atomic schedules file. |
| [`src/history.ts`](src/history.ts) | Bounded run records. |
| [`src/security.ts`](src/security.ts) | Prompt validation and blocked patterns. |

### Dispatch

The scheduler checks once per second. Before dispatch it stores `pending_at`, so a crash after acceptance can retry the same occurrence. After execution it clears the pending occurrence and computes the next target.

A task is not run concurrently with itself. The global execution limit is `max_parallel_runs`.

### Recovery

The schedules file is durable. On startup, a missed recurring task delivers only its latest missed occurrence. A missed one-shot task also delivers at most once. Future occurrences continue normally.

### Permissions

`remind` inherits the source session policy. `agent` and `script` use the task's stored `ask`, `auto`, or `full` policy. In unattended `ask` mode, an unavailable answerer fails closed.

### Limits

The host must be running. There is no daemon, no cross-host election, and no guarantee of exactly-once delivery. Delivery history is a record of attempts, not proof that the model completed the requested work.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-cron](../tool-cron/README.md)
- [agent-runner](../../agent/agent-runner/README.md)
- [background jobs](../../jobs/jobs/README.md)