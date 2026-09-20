---
description: "The packages under packages/: what each one provides, and what it hands to the rest."
kind: "package-group"
---

# packages/

English | [中文](README.zh.md)

## Summary

Every directory under `packages/` is a package, and each one carries one duty: a package the kernel spawns as its own process, a package the others import, a package that decides what one launch does, or a package that lists the rows a profile mounts. To find who owns a capability, look the package up here and open its directory. Package-level conventions live in that package's own README; this page says only what is here.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

Each profile writes its own `$MAOTA_HOME/profiles/<name>/eggshell.toml`, one row per spawned package: the row states the package to run and nothing else, the kernel resolves that name out of the profile's own `node_modules`, and the capability comes from the process itself.

| Package | Directory | Capability | Role |
|---|---|---|---|
| `@maota/agent-core` | [`agent/agent-core`](agent/agent-core/) | `agent.loop` | The package a front end talks to: the system prompt, session bookkeeping, tool wiring and the streaming `run`. |
| `@maota/api` | [`api`](api/) | `api` | The model gateway: an openai backend and a scripted one for tests. |
| `@maota/hmr` | [`boot/hmr`](boot/hmr/) | `dev.hmr` | The development watcher: it publishes `dev.source.changed` for the paths it watches, and its generated row ships disabled. |
| `@maota/pwsh-local` | [`shell/pwsh-local`](shell/pwsh-local/) | `shell` | The provider that runs a command with the local PowerShell. |
| `@maota/session` | [`session`](session/) | `session` | Stored conversations, their titles and their working directories. |
| `@maota/skill` | [`skill`](skill/) | `skill` | The skill list a turn offers the model. |
| `@maota/skill-filesystem` | [`skill-filesystem`](skill-filesystem/) | `skill.filesystem` | Skills read from the filesystem. |
| `@maota/tool-fs` | [`fs/tool-fs`](fs/tool-fs/) | `tool.read`, `tool.write`, `tool.edit` | The tools the model reads, writes and edits files through. |
| `@maota/tool-fs-search` | [`fs/tool-fs-search`](fs/tool-fs-search/) | `tool.glob` | The tool that finds files by path pattern. |
| `@maota/tool-pwsh` | [`shell/tool-pwsh`](shell/tool-pwsh/) | `tool.pwsh` | The tool the model runs commands through. |
| `@maota/tools` | [`agent/tools`](agent/tools/) | `tools` | The tool registry every tool is listed and dispatched through. |
| `@maota/agent-loop` | [`agent/agent-loop`](agent/agent-loop/) |  | The loop engine `agent-core` runs in its own process: the model call, the tool round, the exit reason. |
| `@maota/app-boot` | [`boot/app-boot`](boot/app-boot/) |  | Decides which config file and which kernel binary one launch uses, and generates a profile's config and links. |
| `@maota/base` | [`bundle/base`](bundle/base/) |  | The row list the `default` profile mounts. |
| `@maota/fs` | [`fs/fs`](fs/fs/) |  | The workspace library the file tools share: path containment and atomic writes. |
| `@maota/host` | [`boot/host`](boot/host/) |  | Spawns the kernel and drives it over stdio: invoke, streams, events, shutdown. |
| `@maota/plugin-kit` | [`plugin-kit`](plugin-kit/) |  | The protocol the packages above import: framing, channels, `runPlugin`, tool declaration and the config-key and schema checks. |
| `@maota/shell` | [`shell/shell`](shell/shell/) |  | The command seam: the request and result shapes and `parseExitStatus`. |
| `@maota/web-bundle` | [`bundle/web`](bundle/web/) |  | The single row the `serve` profile adds to the `default` set. |

<a id="bundles"></a>
A profile's rows come from those two lists: `base` mounts the eleven rows it names in that order, with `hmr` disabled, and `web` adds one row, so only the `serve` profile mounts it. The launcher holds one list per profile (`default` names `base`, `serve` names `base` then `web`), and the list a profile actually uses lives in `$MAOTA_HOME/profiles/<name>/package.json`, so adding or dropping one never touches this repository. The `web` capability itself comes from `apps/web`, which sits outside this tree.

`pnpm check:plugins` runs every spawned package's entry with `--check` and validates `provides`, `requires`, `configKeys` and `selfCheck` without a kernel.

<a id="related-documentation"></a>
## Related documentation

- [Architecture](../docs/architecture.md): the component map and the launch path.
- [maota CLI](../apps/cli/README.md): the front end that launches these packages.
- [agent](../agent/README.md): how the agent package and its loop divide the work.
- [dev.hmr](boot/hmr/README.md): the watcher behind event-driven hot reload.