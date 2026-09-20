---
description: "The pwsh tool: the one command the model is offered, its command and timeout parameters, the injected working directory, and the result it renders from the shell capability."
kind: "package-reference"
---

# tool-pwsh

English | [中文](README.zh.md)

## Summary

One capability, `tool.pwsh`, offered to the model as `pwsh`. It carries a command line and an optional timeout, calls the `shell` capability, and renders whatever that provider answered as a status, an exit code and the two output streams. It starts no process itself and knows nothing about PowerShell: the executable, the environment and the sandbox all live behind the capability. The session working directory arrives as the host argument `workdir`, and every call runs alone.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### `pwsh`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `command` | string | Yes | The command line to run. |
| `timeout_ms` | integer | No | Kill the command after this many milliseconds. Defaults to the provider's own `timeout_ms`. |
| `workdir` | string | Host | The session working directory. Injected, never published. |

### The result

| Field | Meaning |
|---|---|
| `command` | The command line that ran. |
| `status` | A label from `parseExitStatus`: `exit 0`, `exit N`, `timed out`, `killed by SIG` or `no exit status`. |
| `ok` | True only for exit code 0. |
| `exit_code` | The number, or `null` when the process reported none. |
| `timed_out` | Whether the provider killed it for running too long. |
| `truncated` | Whether either stream was cut at the byte cap. |
| `stdout`, `stderr` | Both streams as text. |

Concurrency is `never`: a command is not declared safe to run beside another call, so it always runs alone.

### Dependencies and config

| Entry | Meaning |
|---|---|
| requires `shell ^1` | The provider capability this tool calls. `run` forwards to `shell.run` and renders the answer. |
| `configKeys` | None. The timeout, the output cap and the fallback directory belong to the provider. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the forward to `shell.run`, and `selfCheck`. |
| [`src/result.ts`](src/result.ts) | `renderPwshResult`. |

### The tool is a renderer, not a runner

`run` builds a request from the arguments, omitting `timeout_ms` when the model did not send one so the provider's default applies, and passes the call's own abort signal down. It then hands the answer to `renderPwshResult`, which adds `status` and `ok` through `parseExitStatus` and passes every other field through unchanged. Nothing in this package names an executable.

### Why `workdir` is a host argument

The model is not offered a working-directory parameter, so it cannot move a command out of the session's directory. The declaration names `workdir` with `host: "session_cwd"`, which keeps it out of the published schema and makes it required at run time; `agent-core` fills it from the session before the call. A call that arrives without it is a `-32602` naming `arguments.workdir`.

-----

<a id="further-exploration"></a>
## Further exploration

- [pwsh-local](../pwsh-local/README.md): the provider that actually runs the command.
- [shell](../shell/README.md): the request, result and status types shared with the provider.
- [tools](../../agent/tools/README.md): the dispatcher that lists this tool.
- [shell group](../README.md): how the three packages divide the work.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No sandbox parameters**: there is no upgrade path and no justification argument, so a command that needs more room has nowhere to ask.
- **No permission prompt**: a command runs or it does not, with nothing in between.
- **Nothing is offered about the environment**: the model cannot set a variable for the process it starts.
- **`timeout_ms` is the model's to choose**: a call may ask for a longer wait than the provider's default, and only the provider's own ceiling bounds it.