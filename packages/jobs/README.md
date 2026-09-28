---
description: "The jobs group: the background job registry, its model-facing tools, and the lifecycle shared by producers and consumers."
kind: "package-group"
---

# jobs

English | [中文](README.zh.md)

## Summary

The jobs group is the background work seam. A producer registers a job, appends output and progress, and settles it after its resources stop. The owner can list, read, wait for, or kill that job. Completion is published as an event.

Jobs are process-local. They do not survive host shutdown.

## Table of Contents

- [Packages](#packages)
- [Boundaries](#boundaries)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Responsibility | Capability |
|---|---|---|
| [`jobs`](jobs/README.md) | Central registry, admission, owner isolation, output rings, waits, kill requests, and settle events. | `jobs` |
| [`tool-jobs`](tool-jobs/README.md) | Model tools for reading, listing, and stopping jobs. | `tool.job_output`, `tool.job_list`, `tool.job_kill` |

<a id="boundaries"></a>
## Boundaries

- The registry does not spawn work. It stores identity, lifecycle, access, output, and completion state.
- A producer owns the real process or task and must settle only after the work has stopped.
- A job is visible only to its session owner.
- Output is bounded and may be reported as lossy.
- `kill` is a request until the producer settles the job.
- Completion events are delivered to `agent.runner`; the runner decides whether to wake the session.

<a id="related-documentation"></a>
## Related documentation

- [Background tasks user guide](../../docs/user/background-tasks.md)
- [agent-runner](../agent/agent-runner/README.md)
- [pwsh-local](../shell/pwsh-local/README.md)