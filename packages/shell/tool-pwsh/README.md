---
description: "The pwsh tool: the one command the model is offered, its command and timeout parameters, the injected session identity, the approval gate it asks before a destructive command, and the result it renders from the shell capability."
kind: "package-reference"
---

# tool-pwsh

English | [中文](README.zh.md)

## Summary

One capability, `tool.pwsh`, offered to the model as `pwsh`. It carries a command line and an optional timeout, calls the `shell` capability, and renders whatever that provider answered as a status, an exit code and the two output streams. It starts no process itself and knows nothing about PowerShell: the executable, the environment and the sandbox all live behind the capability. The session working directory arrives as the host argument `workdir`, every call runs alone, and a command the permission gate treats as destructive is put to the user before it runs.

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
| `session_id` | string | Host | The session this call belongs to, so the gate can keep a policy per session. Injected, never published. |
| `call_id` | string | Host | The id of this tool call, so an approval can be matched to it. Injected, never published. |

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

### The approval gate

Before it calls `shell.run`, this tool reads the session's permission policy. In `full` the command runs and nothing is asked. Otherwise a command containing one of the three shapes this tool treats as destructive (`rm `, `> /etc/`, `chmod 777`) is put to `permission/request` first, and only the answer `allowed-once` lets it run.

Any other answer comes back as this tool's own result instead: `{ command, status: "approval denied", ok: false, reason }`, where the reason says which answer it got. A refusal is therefore a normal tool result the model can read, not an error.

The wait is wider than a normal capability call on purpose. `approval_timeout_ms` (default 300000) is passed as that call's own `timeout_ms`, because the kernel's default would cut a question off after thirty seconds. A policy that cannot be read is read as the mode that asks, so a deployment without the gate refuses a destructive command instead of running it.

### Dependencies and config

| Entry | Meaning |
|---|---|
| requires `shell ^1` | The provider capability this tool calls. `run` forwards to `shell.run` and renders the answer. |
| requires `permission ^1` (optional) | The gate. Without it the tool still loads, and reads an unreadable policy as the mode that asks. |
| `configKeys` | `approval_timeout_ms`: how long one approval may wait, default 300000. The command timeout, the output cap and the fallback directory belong to the provider. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the policy read, the forward to `shell.run`, and `selfCheck`. |
| [`src/approval.ts`](src/approval.ts) | The three shapes, the reason, the call to the gate, and the refusal result. |
| [`src/result.ts`](src/result.ts) | `renderPwshResult`. |

### The tool is a renderer, not a runner

`run` builds a request from the arguments, omitting `timeout_ms` when the model did not send one so the provider's default applies, and passes the call's own abort signal down. It then hands the answer to `renderPwshResult`, which adds `status` and `ok` through `parseExitStatus` and passes every other field through unchanged. Nothing in this package names an executable.

### Why the session arrives as host arguments

The model is not offered a working-directory parameter, so it cannot move a command out of the session's directory, and it is not offered a session or a call id either, so it cannot claim to be another session or to be answering a question it was not asked. All three are declared with a `host` source, which keeps them out of the published schema and makes them required at run time; `agent-core` fills them from the session and the call before forwarding. A call that arrives without one is a `-32602` naming the missing argument.

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
- **Only three shapes are flagged**: a destructive command that contains none of `rm `, `> /etc/` and `chmod 777` runs without a question, because nothing here classifies a command.
- **Nothing is offered about the environment**: the model cannot set a variable for the process it starts.
- **`timeout_ms` is the model's to choose**: a call may ask for a longer wait than the provider's default, and only the provider's own ceiling bounds it.
