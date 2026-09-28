---
description: "The jobs registry: job identity, owner isolation, admission, lifecycle, bounded output, waits, cancellation, and completion events."
kind: "package-reference"
---

# jobs registry

English | [中文](README.zh.md)

## Summary

The registry owns job ids, owner access, admission limits, lifecycle state, output rings, waits, and settle events. A producer registers before starting work, appends output and progress while it runs, and settles after its resources stop. Records are process-local.

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
| `register` | `{ kind, label, owner?, cwd?, producer, producer_job_id }` | `{ id }`. |
| `append` | `{ id, text, channel?, gap_before? }` | `{}`. |
| `progress` | `{ id, line }` | `{}`. |
| `settle` | `{ id, status, detail?, result? }` | Final job view. |
| `list` | `{ owner? }` | `{ jobs }`. |
| `get` | `{ id, owner? }` | Job view. |
| `read` | `{ id, owner? }` | Output chunks since the model cursor, optional one-time result, and status. |
| `wait` | `{ id, owner?, timeout_ms? }` | Job view at settlement or timeout. |
| `kill` | `{ id, owner?, reason? }` | `{ outcome: "requested" | "already-finished" }`. |

### Status

`running`, `stopping`, `completed`, `failed`, `killed`.

### Events

The registry publishes `jobs.registered`, `jobs.progress`, `jobs.settled`, and `jobs.removed`. A settle event carries `awaited`, so a caller that already consumed the result does not wake the session twice.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `max_jobs_per_owner` | `10` | Running or stopping jobs per owner. |
| `max_jobs_total` | `32` | Running or stopping jobs across the process. |
| `running_output_bytes` | `262144` | Retained output while running. |
| `settled_output_bytes` | `16384` | Retained output after settlement. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Capability definition, configuration, methods, and shutdown. |
| [`src/registry.ts`](src/registry.ts) | Records, lifecycle, waiters, cancellation, and event emission. |
| [`src/admission.ts`](src/admission.ts) | Per-owner and global admission limits. |
| [`src/ring.ts`](src/ring.ts) | Bounded output storage and cursor reads. |
| [`src/events.ts`](src/events.ts) | Event topic names. |

### Lifecycle

Admission happens before the producer starts work. If admission fails, no process or job id is created.

Cancellation moves a live job to `stopping` and calls the producer's `job_cancel`. The job reaches `killed` only after the producer settles.

A producer that disappears leaves an unavailable job. The record can still be inspected and read, but it cannot be revived.

### Output

The running ring keeps the newest bytes. Output older than the reader's retained window is reported as lossy. A terminal result is returned once by `read`, and an explicit wait marks the settlement as `awaited`.

### Limits

Jobs are process-local. Host shutdown ends the records. There is no durable retry queue and no cross-process backend in this package.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-jobs](../tool-jobs/README.md): model-facing controls.
- [agent-runner](../../agent/agent-runner/README.md): completion delivery.
- [shell/pwsh-local](../../shell/pwsh-local/README.md): the first producer.