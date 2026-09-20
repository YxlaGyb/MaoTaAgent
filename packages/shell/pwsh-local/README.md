---
description: "The local PowerShell provider: how a command line is spawned, which executable is chosen, the environment it is given, and how output, timeout and cancellation are bounded."
kind: "package-reference"
---

# pwsh-local

English | [中文](README.zh.md)

## Summary

This provider answers the `shell` capability by starting a real PowerShell process. It takes a command line, a working directory and a timeout, and answers with an exit code, a signal, both output streams and the two flags that say whether the run timed out or was cut short. It reads three config keys and holds no state between calls. A second provider could answer `shell` the same way, which is why this one never appears in the tool's contract.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### The method

| Method | Params | Returns |
|---|---|---|
| `run` | `{ command, workdir?, timeout_ms? }` | `ShellRunResult`: `command`, `exit_code`, `signal`, `timed_out`, `truncated`, `stdout`, `stderr`. |

`command` must be a non-empty string or the call is a `-32602`. `workdir` falls back to the `cwd` config key, and `timeout_ms` falls back to the `timeout_ms` config key.

### Config

| Key | Default | Meaning |
|---|---|---|
| `timeout_ms` | `30000` | How long a command may run per call. |
| `max_output_bytes` | `65536` | The most kept from each of stdout and stderr. |
| `cwd` | none | The directory to run in when the caller names none. |

### The command line

The child is started as `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>`, with the command line as one argument and never as a joined string, so quoting cannot leak into the executable's own argument parsing. Each call is a fresh process: there is no profile, no interactive prompt and no state carried between calls.

### The environment

| Override | Value | Why |
|---|---|---|
| `NO_COLOR` | `1` | Keeps colour escapes out of the captured text. |
| `PAGER` | `cat` | Stops a command from waiting on a pager. |
| `GIT_PAGER` | `cat` | The same, for Git. |

The rest of the parent environment is passed through unchanged.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The definition: config, the `run` method and `selfCheck`. |
| [`src/pwsh.ts`](src/pwsh.ts) | `runPwsh`, the encoding preamble, the environment overrides and the executable search. |

### Which executable runs

`pwshCandidates` returns `MAOTA_PWSH` when it is set, then `pwsh`, then `powershell`, with duplicates dropped. `runPwsh` tries them in order and only moves on when a start failed with `ENOENT`; any other failure is reported at once. When every candidate fails, the call is a `-32603` naming the last error.

### Encoding is set before the command

The command line is prefixed with a fixed preamble that assigns `[Console]::OutputEncoding` and `$OutputEncoding` to UTF-8 without a byte order mark. Without it, a non-ASCII character in the output would be mangled by the console code page before Node ever saw it.

### Bounds on one run

Each stream is capped at `max_output_bytes`, counted separately, and the first chunk that does not fit sets `truncated`. A timer kills the process at `timeout_ms` and sets `timed_out`. An abort signal kills it too, and one that fires before the spawn returns still kills the child on the next line. The result is resolved from the process close event, so a killed process still reports whatever exit code or signal the platform gave it, and the timer and the abort listener are removed once it settles.

-----

<a id="further-exploration"></a>
## Further exploration

- [shell](../shell/README.md): the request and result shapes this provider answers with.
- [tool-pwsh](../tool-pwsh/README.md): the tool that calls this capability.
- [shell group](../README.md): how the three packages divide the work.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No sandbox**: the command runs with the full rights of the host process.
- **No background commands and no persistent session**: every call is a new process, so a shell variable set in one call is gone in the next.
- **Output is dropped, not folded**: past the cap the extra bytes are discarded, and the tool reports only that the stream was cut.
- **The cap is per stream**: stdout and stderr are each allowed `max_output_bytes`, so a run can return twice that in total.
- **A kill is a kill**: a process that ignores a termination request is not escalated to a harder one.