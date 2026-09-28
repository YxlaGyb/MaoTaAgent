# Scheduled tasks

English | [中文](scheduled-tasks.zh.md)

A scheduled task runs later or repeatedly. Schedules are durable definitions. The host must be running for dispatch, but the definitions and run history survive a restart.

## Table of Contents

- [Modes](#modes)
- [Time selectors](#time-selectors)
- [Managing schedules](#managing-schedules)
- [Permissions](#permissions)
- [Recovery](#recovery)
- [Delivery](#delivery)
- [Limits](#limits)
- [Related documentation](#related-documentation)

-----

<a id="modes"></a>
## Modes

| Mode | Behavior |
|---|---|
| `remind` | Sends a reminder to the original session. Context and permission policy remain with that session. |
| `agent` | Runs a self-contained prompt in a fresh session. The prompt cannot rely on the current conversation. |
| `script` | Runs a controlled script below `$MAOTA_HOME/scripts` without a model or shell interpolation. |

Use `remind` for context-bound reminders. Use `agent` for unattended work. Use `script` when a deterministic check or command is enough.

<a id="time-selectors"></a>
## Time selectors

- `after_seconds`: one-shot delay.
- `at`: one-shot absolute RFC3339 time.
- `every_seconds`: fixed interval.
- `daily`: local time in an explicit IANA timezone.
- `weekly`: local time plus ISO weekdays in an explicit IANA timezone.
- `cron`: five-field Vixie expression in an explicit IANA timezone.

Calendar and cron schedules require `timezone`. The cron dialect rejects seconds, `L`, `W`, `#`, and month or weekday names.

<a id="managing-schedules"></a>
## Managing schedules

The model tools are:

- `cron_create`
- `cron_list`
- `cron_update`
- `cron_delete`
- `cron_run_now`

The CLI uses `maota cron list`, `add`, `update`, `remove`, `run`, `pause` and `resume`. Both surfaces call the `schedule` capability and never write the schedules file directly.

Every schedule needs a title. Create and update validate the selector, timezone, mode, permission and script path before storing anything.

<a id="permissions"></a>
## Permissions

`remind` inherits the source session policy. `agent` and `script` store `ask`, `auto`, or `full` with the task. The default is `ask`. In unattended `ask` mode, an unavailable answerer fails closed.

Use `auto` or `full` only when the task is intentionally allowed to run without a person present.

<a id="recovery"></a>
## Recovery

Schedule definitions live in `$MAOTA_HOME/schedules.json`. Run records live under `$MAOTA_HOME/schedule-runs`.

After restart, a recurring task receives at most its latest missed occurrence. A missed one-shot task also runs at most once. There is no bulk catch-up.

<a id="delivery"></a>
## Delivery

A reminder or result enters the session through `agent.runner`, the same path used by background job completion. If the session is busy, the message waits for the current turn. If the session is idle, the runner starts a follow-up turn within the wake budget.

Scheduled model turns cannot create or change schedules. This prevents recursive scheduling.

<a id="limits"></a>
## Limits

- The host must be running.
- Delivery is at least once in failure cases, not exactly once.
- A task does not run concurrently with itself.
- The default global concurrency is two runs.
- Run history is bounded to 200 records and 30 days per task.
- A run record shows delivery and status. It does not prove that the model completed the real-world work.

<a id="related-documentation"></a>
## Related documentation

- [Schedule package group](../../packages/schedule/README.md)
- [tool-cron](../../packages/schedule/tool-cron/README.md)
- [agent-runner](../../packages/agent/agent-runner/README.md)