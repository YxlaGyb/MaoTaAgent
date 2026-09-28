---
description: "The model-facing cron tools: create, list, update, delete, and run a schedule immediately."
kind: "package-reference"
---

# tool-cron

English | [中文](README.zh.md)

## Summary

Provides `cron_create`, `cron_list`, `cron_update`, `cron_delete`, and `cron_run_now` as separate tools so schema and permissions can be scoped per action.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Tools

| Tool | Purpose |
|---|---|
| `cron_create` | Create a `remind`, `agent`, or `script` schedule. |
| `cron_list` | List schedules and their next occurrence, run count, and status. |
| `cron_update` | Change selected fields without replacing the schedule. |
| `cron_delete` | Delete one schedule by id. |
| `cron_run_now` | Run immediately without moving the next occurrence. |

### Creation fields

- `title` is required.
- `mode` is required.
- `schedule_kind` selects `after`, `at`, `every`, `daily`, `weekly`, or `cron`.
- `daily`, `weekly`, and `cron` require `timezone`.
- `remind` requires the source session and cwd injected by host arguments.
- `agent` requires a self-contained prompt.
- `script` requires a relative script path below `$MAOTA_HOME/scripts`.
- `permission` defaults to `ask` for agent and script modes.
- `max_runs` and `not_after` are optional limits.

### Results

Create and update return a schedule view. List returns active and inactive schedules. Delete returns the id and deletion flag. `run_now` returns a run record.

### Errors

Invalid selectors, timezones, cron syntax, schedule paths, or permission values are rejected before storage. Unknown ids return an error. Scheduled model turns cannot call these tools recursively.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool declarations and schedule calls. |
| [`src/render.ts`](src/render.ts) | Schedule and run rendering. |

### Separation

The tool plugin owns only validation and model-facing shapes. Persistence, timing, execution, and history belong to the `schedule` capability.

### Ownership

Host arguments inject the source session and cwd. The model cannot choose another session as the reminder target.

-----

<a id="further-exploration"></a>
## Further exploration

- [schedule service](../schedule/README.md)
- [scheduled tasks user guide](../../../docs/user/scheduled-tasks.md)
- [agent-runner](../../agent/agent-runner/README.md)