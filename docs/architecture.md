# Architecture

English | [中文](architecture.zh.md)

MaoTa is a plugin-based agent harness: a Rust kernel runs each plugin as its own child process, routes capabilities between them, and exposes one stdio protocol; the Node side is a front end that launches that kernel and drives it. This page is the map, not the contract; every component below owns its details in its own README or source file.

## Components

| Component | What it is | Contract |
|---|---|---|
| `apps/cli` | The `maota` launcher: interactive, one-shot, `serve` and `check`. | [README](../apps/cli/README.md) |
| `apps/web` | The web plugin: one HTTP server for the UI and the host RPC. It ships in the `serve` profile only. | `apps/web/src/index.ts` |
| `packages/boot/app-boot` | Resolves the config file and the kernel binary for one launch. | [README](../packages/boot/app-boot/README.md) |
| `packages/boot/host` | Spawns the kernel and drives it over stdio. | [README](../packages/boot/host/README.md) |
| `packages/boot/hmr` | The development watcher plugin: publishes `dev.source.changed` for the paths it watches. | `packages/boot/hmr/src/index.ts` |
| `packages/*` | The kernel plugins: api, shell, tools, skill, skill-filesystem, session, agent. | `packages/<name>/src/index.ts`, and `packages/agent/agent-core/src/index.ts` for the agent |
| `packages/bundle/*` | The bundles: each lists the plugin rows a profile mounts, by package name. | [packages README](../packages/README.md#bundles) |
| `eggshell` binary | The kernel itself, plus its stdio protocol. | The `eggshellmod` repository |

## Launch path

1. `maota` resolves the config file and the kernel binary.
2. It spawns the kernel and waits for the capability table.
3. The kernel starts every `[plugins.<id>]` entry as its own child process and routes capabilities by each plugin's `provides`.
4. The front end invokes capabilities: the CLI drives `agent.loop`, while the web app drives `session` and `agent.loop` through its own bridge.
5. Shutdown asks the kernel for `ui_quit` or `kernel_exit`; the kernel stops its plugins and exits with the code the host reports.

A development run may also carry the `hmr` plugin, whose generated row ships disabled: it publishes `dev.source.changed` with the path that changed. From each `kernel.plugin.started` event the CLI reads the resolved entry and walks that entry's static import graph, keeping a file-to-plugin index; a changed path is then resolved to exactly the plugins that import it, and those are restarted with `reason: "source"`.

## Configuration layering

- Nothing lives in the repository root: the launcher reads `$MAOTA_HOME`, default `~/.maota`. Each profile owns a `node_modules` with one link per row, pointing at the package in this repository.
- The launcher picks one profile: serve boots serve (base plus web), every other command boots default (base alone).
- $MAOTA_HOME/profiles/<name>/eggshell.toml is generated from the bundles that profile lists. Every row names its package, and the kernel resolves that name out of the profile's own `node_modules`, so boot rewrites the file only when the rows change. It holds the plugin set: which plugins exist and how they start, since every plugin keeps its own defaults.
- `$MAOTA_HOME/profiles/<name>/eggshell.local.toml` holds the machine's layer: gateway, model, keys. It `extends` the generated file and wins over it.
- A row with `disabled = true` is parsed and merged like any other, but the kernel never spawns it and its capability is not in the routing table. A later layer writing `false` enables it, and the kernel's reloader picks that up without a restart.
- Later layers win: tables merge key by key, arrays are replaced wholesale.
- Stray config keys are reported, not blocked, by `pnpm run check:config`.

## Boundaries

- Plugins never call each other directly; they go through capabilities the kernel routes.
- The Node host never interprets plugin config values; it picks paths and speaks the protocol.
- `apps/web` is a plugin like any other; the browser side holds no kernel privileges of its own.
- The kernel never watches source files; it watches its own config and restarts one named plugin when a host asks it to.

## Related documentation

- [boot package group](../packages/boot/README.md)
- [maota CLI](../apps/cli/README.md)
- [Defensive patterns](defensive-patterns.md)
