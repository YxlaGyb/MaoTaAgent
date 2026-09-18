---
description: "The development watcher plugin: watch configured roots for file changes and publish dev.source.changed so a host can restart the plugins that actually import them."
kind: "package-reference"
---

# dev.hmr

English | [中文](README.zh.md)

## Summary

`hmr` is a development-only plugin: it watches the directories named in `roots` and publishes `dev.source.changed` with the path that changed. It decides nothing else: the host maps that path through each plugin's module graph and restarts the plugins that import it. Nothing is watched in a run that does not load this plugin, so a production config simply leaves the row out. It provides one capability, `dev.hmr@0.1.0`, whose only method is `status`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Add the row to the machine layer when you are editing the plugin tree and want the kernel to restart what changed.

### Enabling the row

The generated `$MAOTA_HOME/eggshell.toml` ships the row disabled; flip that key to `false`, or restate the row in the machine layer, to turn it on:

```toml
[plugins.hmr]
disabled = false
command = "node"
args = ["<repo>/packages/hmr/src/main.ts"]
[plugins.hmr.config]
roots = ["<repo>/apps", "<repo>/packages"]
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `roots` | `["apps", "packages"]` | Directories to watch, resolved against the plugin's working directory. Entries that do not exist are skipped. |

The ignore set is fixed: a changed path carrying `node_modules`, `.git`, `dist` or `target` as a segment publishes nothing. Changes are debounced for 100 ms, then one `dev.source.changed` per changed path is published.

### Events

| Topic | Payload | Meaning |
|---|---|---|
| `dev.source.changed` | `{ path }` | One watched file changed; `path` is absolute. |

### Observing success

`invoke("dev.hmr", "status")` answers `{ roots, watching }`: the roots it used and how many watchers are live. A run whose roots all went missing answers `watching: 0`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

This section explains how one plugin turns raw filesystem events into the single topic above; the config it reads is covered in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/main.ts`](src/main.ts) | The whole plugin: definition, watch setup, debounce and `status` |

### Watching and debouncing

`start` opens one `fs.watch(root, { recursive: true })` per existing root and keeps the channel it publishes through. A raw event is filtered against the ignore set, resolved to an absolute path and put in a pending set; the first entry starts a 100 ms timer whose callback publishes one `dev.source.changed` per pending path. `close` clears the timer, drops the pending set and closes every watcher. A failed publish is logged as a warning instead of thrown, so one bad path never stops the watcher.

### Config checks

`selfCheck` fails a `--check` run when `roots` is empty or names a directory that does not exist, so `pnpm check:plugins` catches a typo before a run does.

-----

<a id="further-exploration"></a>
## Further exploration

- [packages group](../README.md): the plugin tree this package belongs to.
- [maota CLI](../../apps/cli/README.md#dev-hot-reload): the host that consumes these events and restarts plugins.
- [Architecture](../../docs/architecture.md#launch-path): where a development run differs from a production one.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits say when this watcher needs care. They are current constraints, not a task backlog.

- **Recursive watching is emulated on Linux**: native on Windows and macOS, polled on Linux, so a deep tree there costs more.
- **It publishes paths, not ownership**: mapping a path to the plugins that import it belongs to the host and its module graph.
- **A missing root is skipped, not awaited**: it is read again on the next plugin start, and never watched into existence.
- **The ignore set and the debounce interval are fixed in code**: neither is configurable.
- **A disabled row is never spawned**: while the plugin is off, `--check` does not reach it either.
