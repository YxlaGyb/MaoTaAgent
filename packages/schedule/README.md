---
description: "The schedule group: durable reminders and automation, plus the model-facing cron tools."
kind: "package-group"
---

# schedule

English | [中文](README.zh.md)

## Summary

The schedule group is the persistent automation seam. It stores schedules, computes the next occurrence, dispatches work, records history, and exposes separate model tools for management. It is independent of the process-local jobs registry.

## Table of Contents

- [Packages](#packages)
- [Boundaries](#boundaries)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Responsibility | Capability |
|---|---|---|
| [`schedule`](schedule/README.md) | Persistent store, clock, execution modes, permissions, concurrency, history, and scheduler loop. | `schedule` |
| [`tool-cron`](tool-cron/README.md) | Five model tools for schedule management. | `tool.cron_create`, `tool.cron_list`, `tool.cron_update`, `tool.cron_delete`, `tool.cron_run_now` |

<a id="boundaries"></a>
## Boundaries

- A schedule is a durable definition, not a running process.
- `remind` sends a system message to the original session.
- `agent` runs a self-contained prompt in a fresh session.
- `script` runs a controlled script without a model.
- The scheduler runs only while the host is running.
- Recurring tasks are not backfilled in bulk. After restart, each task receives at most its latest missed occurrence.
- Scheduled model turns cannot create or change schedules.

<a id="related-documentation"></a>
## Related documentation

- [Scheduled tasks user guide](../../docs/user/scheduled-tasks.md)
- [agent-runner](../agent/agent-runner/README.md)
- [jobs registry](../jobs/jobs/README.md)