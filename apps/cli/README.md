# `@maota/cli`

English | [中文](README.zh.md)

`maota` is MaoTa's only Node launcher: it picks which config file and which kernel binary this run uses, boots the eggshell kernel as a child process, and drives it over the kernel's stdio protocol. [`src/args.ts`](src/args.ts) owns the command grammar and [`src/index.ts`](src/index.ts) owns the entry modes and the terminal rendering. Unknown options, an option without a value, extra arguments to `serve` or `check`, and a missing config file all exit nonzero.

## Table of Contents

- [Entry modes](#entry-modes)
- [Options](#options)
- [Exit codes](#exit-codes)
- [Configuration resolution](#configuration-resolution)
- [Dev hot reload](#dev-hot-reload)
- [Development](#development)

-----

<a id="entry-modes"></a>
## Entry modes

| Command | Behaviour |
|---|---|
| `maota` | Interactive: a `> ` prompt on a TTY, one turn per line otherwise. |
| `maota <question>` | One-shot: ask once, print the final answer, exit. |
| `maota serve` | Resident: boot, report the web plugin's URL, stay until Ctrl-C. |
| `maota check` | Check only: run the kernel's own `--check` and pass its exit code through. |
| `maota --help` | Print the usage text and exit 0. |
| `maota --version` | Print `maota <version>` and exit 0. |

The first positional argument decides: `serve` and `check` are subcommands and take no further arguments, while any other positional argument starts a one-shot question whose remaining arguments are joined with spaces.
`maota check` prints whatever the kernel prints. A plugin the kernel holds back because a capability it requires has no provider, and a plugin row switched off with `disabled = true`, are both warnings: the check still exits 0, and the report names them in `disabled` and `blocked` (the kernel documents both fields in `docs/PROTOCOL.md` section 14.1).

A subagent's work happens inside the turn that started it, so the CLI prints it indented rather than folding it into the turn's own output: every `agent.subagent.*` event naming the session this run drives becomes one line, such as `  [explore sub-3f2a] -> read src/a.ts`. Nothing else about the child reaches the terminal, and its answer still arrives as the result of the `task` call that started it.

<a id="options"></a>
## Options

| Option | Meaning |
|---|---|
| `--profile <name>` | Which profile to boot: `serve` for the `serve` command, `default` otherwise. |
| `--kernel <bin>` | Kernel binary to spawn. |
| `--session <id>` | Session id, default `cli`. |
| `--json` | `check` only: ask the kernel for a JSON report. |
| `-h`, `--help` | Print the usage text and exit 0. |
| `-v`, `--version` | Print the version and exit 0. |

`--help` and `--version` win over everything else on the same line.

<a id="exit-codes"></a>
## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean exit, including a kernel shutdown that returned 0. |
| 1 | Runtime failure: the kernel did not boot, a stream reported an error, or the kernel exited badly. |
| 2 | Usage or config error: unknown option, missing option value, extra argument to `serve` or `check`, config file not found. |
| other | Whatever the kernel's `shutdown` returned, passed through unchanged. |

<a id="configuration-resolution"></a>
## Configuration resolution

Both inputs are picked by [`@maota/app-boot`](../../packages/boot/app-boot/README.md) before anything is spawned:

- Config file: `--config`, then `EGGSHELL_CONFIG`, then `$MAOTA_HOME/profiles/<profile>/eggshell.local.toml` when it exists, then the generated `eggshell.toml` beside it; `MAOTA_HOME` defaults to `~/.maota`. A first run writes the profile manifest, generates that config from the bundles the profile lists, and links each row's package into the profile's own `node_modules`; `MaoTa: wrote <path>` goes to stderr. An explicit `--config` is never written to, and a missing one exits 2 before the kernel is spawned.
- Profile: `--profile`, else `serve` for the `serve` command and `default` for every other one. A profile is a directory under `$MAOTA_HOME/profiles`; its `package.json` records the bundle list boot reads back, so the plugin set can be changed from the home directory alone.
- Kernel binary: `--kernel`, then `EGGSHELL_BIN`, then the installed `eggshell-kernel` binary, then the neighbouring `eggshellmod` debug build.

Log lines on the kernel's stderr go to stderr: `serve` drops `info` lines and prefixes what it keeps with `MaoTa`, every other mode prefixes with `[kernel]`.

<a id="dev-hot-reload"></a>
## Dev hot reload

The generated config ships an `hmr` plugin row that is disabled. Enable it in the machine layer and point `roots` at the trees you edit:

```toml
[plugins.hmr]
disabled = false
name = "@maota/hmr"
[plugins.hmr.config]
roots = ["<repo>/apps", "<repo>/packages"]
```

That plugin watches `roots` and publishes `dev.source.changed` with the path that changed. For every `kernel.plugin.started` event the CLI reads the plugin's resolved `cwd` and entry argument, walks that entry's static import graph ([`src/graph.ts`](src/graph.ts)), and remembers which plugin imports which file. Each `dev.source.changed` path is then resolved to exactly the plugins that import it, and those are restarted with `reason: "source"` ([`src/hmr.ts`](src/hmr.ts)). A shared file such as `packages/plugin-kit/src/index.ts` restarts every plugin that imports it; a path nobody imports restarts nothing. Without the row nothing is watched at all, so a production run carries no watcher and the CLI adds no watching of its own.
When the kernel holds a plugin back because something it requires is missing, it publishes `kernel.plugin.blocked` with the plugin and the capabilities it waits for, and the CLI prints one stderr line: `MaoTa: <plugin> waits for <capability>`. That is the same waiting state the reloader leaves a running plugin in when its provider goes away, and the reload that brings the provider back starts it again.

<a id="development"></a>
## Development

Run from source; there is no build step for this app:

| Command | Effect |
|---|---|
| `pnpm boot` | Interactive or one-shot, whichever the terminal allows. |
| `pnpm boot "question"` | One-shot with a question. |
| `pnpm web` | Same as `maota serve`. |
| `pnpm check:config` | Same as `maota check`. |
| `pnpm cli:smoke` | Grammar and usage-text smoke test, no kernel needed. |

`pnpm boot` forwards everything after the script name to `maota`, so `pnpm boot serve`, `pnpm boot check --json` and `pnpm boot --session web "a question"` work too.

`package.json` declares `bin.maota` for a future install; inside this repository nothing links that bin into `node_modules`, so run the file with `node` or through the `pnpm` scripts above.

The first Ctrl-C asks the kernel to shut down with `ui_quit` and exits with the code the kernel returns; later Ctrl-C keystrokes are ignored while that shutdown is in flight. `check` deliberately bypasses `boot()` and uses the kernel's own checker with inherited stdio, so its diagnostics and exit code are the kernel's.

Seven facts bound this launcher. Options never reach plugins, since every plugin setting lives in the profile's `eggshell.toml` or the `eggshell.local.toml` beside it, and `serve` has no options of its own because the web port comes from `[plugins.web.config]` alone. A `serve` whose web plugin never listens waits forever, because there is no startup deadline. Sessions are addressed by `--session` only. The import graph is read statically, so a module reached only through a computed specifier or a path alias is not in the graph and editing it restarts nothing. Hot reload restarts whole plugin processes, so nothing inside a plugin survives a restart. And all of it needs the `hmr` row enabled, while the generated one is disabled.
