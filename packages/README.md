---
description: "The plugin group: every kernel plugin MaoTa ships, the capability each provides, and the entry point the kernel spawns."
kind: "package-group"
---

# packages/: the plugin tree

English | [中文](README.zh.md)

## Summary

Every directory here is either a plugin the kernel spawns as its own process or a library the plugin tree shares. A plugin speaks the eggshell protocol on stdio and is never imported by another process; the kernel routes a capability to whatever plugin declares it in its `initialize` reply. Read this page to find which plugin owns a capability, then open that plugin's directory. Each package README owns its own contract; this page only maps what is here.

## Table of Contents

- [Plugins](#plugins)
- [Libraries](#libraries)
- [Related documentation](#related-documentation)

-----

<a id="plugins"></a>
## Plugins

The generated `$MAOTA_HOME/eggshell.toml` has one row per plugin: the kernel runs `command` + `args` and learns the capability from the process itself.

| Plugin | Capability | Entry |
|---|---|---|
| [`agent`](agent/) | `agent.loop` | `src/main.ts` |
| [`api`](api/) | `api` | `src/main.ts` |
| [`hmr`](hmr/) | `dev.hmr` | `src/main.ts` |
| [`session`](session/) | `session` | `src/main.ts` |
| [`shell`](shell/) | `tool.shell` | `src/main.ts` |
| [`skill`](skill/) | `skill` | `src/main.ts` |
| [`skill-filesystem`](skill-filesystem/) | `skill.filesystem` | `src/main.ts` |
| [`tools`](tools/) | `tools` | `src/main.ts` |

`hmr` is development-only and ships as a `disabled` row. [`apps/web`](../apps/web) is an app rather than a package and provides `web`. `pnpm check:plugins` runs every entry with `--check` and validates `provides`, `requires`, `configKeys` and `selfCheck` without a kernel.

<a id="libraries"></a>
## Libraries

| Directory | Role |
|---|---|
| [`plugin-kit`](plugin-kit/) | The Node side of the plugin protocol: framing, channel, `runPlugin`, config-key checks. Every plugin above imports it. |
| [`boot`](boot/) | Host-side launch glue: which config file and kernel binary a run uses, and the Node host that drives the kernel. |

<a id="related-documentation"></a>
## Related documentation

- [Architecture](../docs/architecture.md): the component map and the launch path.
- [maota CLI](../apps/cli/README.md): the front end that boots these plugins.
- [dev.hmr](hmr/README.md): the watcher whose events drive hot reload.
