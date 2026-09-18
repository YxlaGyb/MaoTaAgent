# Architecture

English | [中文](architecture.zh.md)

MaoTa is a plugin-based agent harness: a Rust kernel runs each plugin as its own child process, routes capabilities between them, and exposes one stdio protocol; the Node side is a front end that launches that kernel and drives it. This page is the map, not the contract; every component below owns its details in its own README or source file.

## Components

| Component | What it is | Contract |
|---|---|---|
| `apps/cli` | The `maota` launcher: interactive, one-shot, `serve` and `check`. | [README](../apps/cli/README.md) |
| `apps/web` | The web plugin: one HTTP server for the UI and the host RPC. | `apps/web/src/main.ts` |
| `packages/boot/config` | Resolves the config file and the kernel binary for one launch. | [README](../packages/boot/config/README.md) |
| `packages/boot/host` | Spawns the kernel and drives it over stdio. | [README](../packages/boot/host/README.md) |
| `packages/*` | The kernel plugins: api, shell, tools, skill, skill-filesystem, session, agent. | `packages/<name>/src/main.ts` |
| `eggshell` binary | The kernel itself, plus its stdio protocol. | The `eggshellmod` repository |

## Launch path

1. `maota` resolves the config file and the kernel binary.
2. It spawns the kernel and waits for the capability table.
3. The kernel starts every `[plugins.<id>]` entry as its own child process and routes capabilities by each plugin's `provides`.
4. The front end invokes capabilities: the CLI drives `agent.loop`, while the web app drives `session` and `agent.loop` through its own bridge.
5. Shutdown asks the kernel for `ui_quit` or `kernel_exit`; the kernel stops its plugins and exits with the code the host reports.

## Configuration layering

- `eggshell.toml` holds the repository's plugin set: which plugins exist, how they start, and the system prompt.
- `eggshell.local.toml` holds the machine's layer: gateway, model, keys. It is untracked and `extends` the tracked file.
- Later layers win: tables merge key by key, arrays are replaced wholesale.
- Stray config keys are reported, not blocked, by `pnpm run check:config`.

## Boundaries

- Plugins never call each other directly; they go through capabilities the kernel routes.
- The Node host never interprets plugin config values; it picks paths and speaks the protocol.
- `apps/web` is a plugin like any other; the browser side holds no kernel privileges of its own.

## Related documentation

- [boot package group](../packages/boot/README.md)
- [maota CLI](../apps/cli/README.md)
- [Defensive patterns](defensive-patterns.md)
