---
description: "The model-facing background job tools: job_output, job_list, and job_kill."
kind: "package-reference"
---

# tool-jobs

English | [中文](README.zh.md)

## Summary

Provides `job_output`, `job_list`, and `job_kill`. The tools never start work. A producer such as `tool-pwsh` registers a background job, returns its id, and the model reads or stops it later. Completion notices tell the model when to act.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Tools

| Tool | Parameters | Result |
|---|---|---|
| `job_output` | `job_id`, `wait?`, `timeout_ms?` | New output, lossy flag, status, and one-time terminal result. |
| `job_list` | none | Owned jobs with id, kind, status, and label. |
| `job_kill` | `job_id`, `reason?` | Cancellation request or already-finished result. |

`job_output` is non-blocking by default. `wait: true` uses a 30 second default and a 10 minute maximum. A timeout leaves the job running.

`job_kill` asks the producer to stop. The job settles as `killed` only after the producer reports that resources stopped.

### Model guidance

The plugin registers a system prompt section telling the model to:

- Keep every job id.
- Continue independent work instead of polling.
- Use `job_output` before a final answer when a job still matters.
- Kill work that no longer matters.

### Dependencies

Requires `jobs`. Uses `system-prompt` when available to register the guidance section.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool declarations, jobs calls, prompt registration, and self-check. |
| [`src/render.ts`](src/render.ts) | Job list and output rendering. |

### Ownership

Every tool call injects `session_id` as a host argument. The registry checks that the job belongs to that session. The model cannot read or kill another session's job.

### Terminal result

The producer's `result` is returned once after settlement. A model that explicitly waited for the job has already received the settlement, so the registry marks it as `awaited` and the runner does not send a duplicate wake.

### Limits

The tool surface has no job-start method. Starting work belongs to the tool that owns the producer, such as `pwsh` with `run_in_background: true`.

-----

<a id="further-exploration"></a>
## Further exploration

- [jobs registry](../jobs/README.md)
- [agent-runner](../../agent/agent-runner/README.md)
- [tool-pwsh](../../shell/tool-pwsh/README.md)