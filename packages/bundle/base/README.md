---
description: "The base row list: the twenty-six plugin rows the default profile mounts, the order they are mounted in, and why that order matters to the tool dispatcher."
kind: "package-reference"
---

# base

English | [中文](README.zh.md)

## Summary

This package holds one array and nothing else: the list of rows a profile mounts. Each row names a package and optionally a config block, and the launcher turns the list into a generated `eggshell.toml` plus a link per package inside the profile directory. The order is part of the contract, because the tool dispatcher discovers its tools from the capabilities that already exist when it starts. `hmr` is the one row that ships disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { rows } from "@maota/base";
```

| Export | Shape | Meaning |
|---|---|---|
| `rows` | `PluginRow[]` | The rows, in mount order. |
| `PluginRow` | `{ id, name, disabled?, config? }` | One row. `id` is the key the config block and the log lines use, and `name` is the package to spawn. |

### The rows

| id | Package | Capability |
|---|---|---|
| `api` | `@maota/api` | `api` |
| `i18n` | `@maota/i18n-native` | `i18n` |
| `jobs` | `@maota/jobs` | `jobs` |
| `pwsh-local` | `@maota/pwsh-local` | `shell` |
| `permission` | `@maota/permission` | `permission` |
| `tool-pwsh` | `@maota/tool-pwsh` | `tool.pwsh` |
| `tool-jobs` | `@maota/tool-jobs` | `tool.job_output`, `tool.job_list`, `tool.job_kill` |
| `tool-fs` | `@maota/tool-fs` | `tool.read`, `tool.write`, `tool.edit` |
| `tool-fs-search` | `@maota/tool-fs-search` | `tool.glob`, `tool.grep` |
| `tool-todo` | `@maota/tool-todo` | `tool.todo_write` |
| `tool-subagent` | `@maota/tool-subagent` | `tool.task` |
| `tools` | `@maota/tools` | `tools` |
| `tool-skill` | `@maota/tool-skill` | `tool.skill` |
| `skill` | `@maota/skill` | `skill` |
| `skill-filesystem` | `@maota/skill-filesystem` | `skill.filesystem` |
| `skill-bundled` | `@maota/skill-bundled` | `skill.bundled` |
| `session` | `@maota/session` | `session` |
| `hooks` | `@maota/hooks-native` | `hooks`, with an 80 KiB context budget |
| `context-agent-instructions` | `@maota/context-agent-instructions` | `hook.agent-instructions` |
| `memory` | `@maota/memory` | `hook.memory`, `tool.memory` |
| `system-prompt` | `@maota/system-prompt` | `system-prompt` |
| `agent-core` | `@maota/agent-core` | `agent.loop` |
| `agent-runner` | `@maota/agent-runner` | `agent.runner` |
| `schedule` | `@maota/schedule` | `schedule` |
| `tool-cron` | `@maota/tool-cron` | `tool.cron_create`, `tool.cron_list`, `tool.cron_update`, `tool.cron_delete`, `tool.cron_run_now` |
| `hmr` | `@maota/hmr` | `dev.hmr`, disabled by default |

### Order

Providers sit above dispatchers: `tool.*` plugins, `shell` and `permission` come before `tools`; skill providers come before `skill`; hook providers come before `hooks`. `agent-runner` follows `agent-core`, `schedule` follows `agent-runner`, and `tool-cron` can arrive after `tools` because the dispatcher rebuilds from `kernel.capabilities.changed`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/rows.ts`](src/rows.ts) | `PluginRow` and `rows`. |
| [`src/index.ts`](src/index.ts) | Re-exports. |

### How a row becomes a running plugin

`app-boot` reads `maota.bundle.rows` out of this package's `package.json`, imports that file, and walks the array. It rejects a duplicate `id` across bundles, links each named package into the profile directory so the kernel can resolve it, and renders the generated `eggshell.toml` from the list. A row with a `config` object is rendered as that plugin's config block, and a disabled row is written as disabled.

### Where a user overrides things

The generated file is not the file a user edits. The profile directory also holds `eggshell.local.toml`, which extends the generated one, and that is where a config block such as `[plugins.tools.config]` belongs. Since a row names a package and nothing else, swapping a provider means editing the row list or the local layer, not editing this package.

A bundle is one list, and a profile mounts all of it or none, so dropping a single row means editing this array. Order is manual: nothing checks that a provider sits above its dispatcher, and a mistake shows up as a tool that is simply missing. A config block ships in the generated file only when the row carries one, and everything else belongs to the user's local layer. The disabled row is still written, so `hmr` appears switched off in a fresh config and turning it on needs no other change.

-----

<a id="further-exploration"></a>
## Further exploration

- [web bundle](../web/README.md): the row the serve profile adds to this list.
- [app-boot](../../boot/app-boot/README.md): the code that reads this list and generates a profile.
- [packages group](../../README.md): what each named package provides.
- [bundle group](../README.md): what a row list is.
