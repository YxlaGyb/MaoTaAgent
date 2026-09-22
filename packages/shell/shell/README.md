---
description: "The seam a command runner answers to: the request and result shapes every shell provider shares, and the one function that turns an exit status into a label."
kind: "package-reference"
---

# shell

English | [中文](README.zh.md)

## Summary

This is the smallest package in the group and the one both halves agree on. It holds two interfaces and one function, and it starts nothing, imports nothing from the repository and reads no config. A provider answers `shell.run` with a `ShellRunResult`; a tool renders that result for the model; `parseExitStatus` is the shared reading of an exit code so two renderers cannot disagree about what a killed process looks like. It is imported by the provider and by the tool, and spawned by neither.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

```ts
const result = await ctx.channel.call("shell", "run", request, { signal });
const status = parseExitStatus(result);
```

| Export | Shape | Meaning |
|---|---|---|
| `ShellRunRequest` | `{ command, workdir?, timeout_ms? }` | What a caller asks for. `command` is required and is the whole command line. |
| `ShellRunResult` | `{ command, exit_code, signal, timed_out, truncated, stdout, stderr }` | What a provider answers. `exit_code` is `null` when the process never reported one. |
| `parseExitStatus(result)` | `{ ok, label }` | The shared reading of a finished run. |

| Status | `ok` | `label` |
|---|---|---|
| The run timed out | No | `timed out` |
| The exit code is 0 | Yes | `exit 0` |
| The exit code is any other number | No | `exit N` |
| There is no exit code but there is a signal | No | `killed by SIG` |
| Neither | No | `no exit status` |

Timeout is checked before the exit code, because a killed process can still report one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | `ShellRunRequest` and `ShellRunResult`. |
| [`src/render.ts`](src/render.ts) | `ExitStatus` and `parseExitStatus`. |
| [`src/index.ts`](src/index.ts) | Re-exports. |

### Why the result is not just a string

A provider that only returned output would lose the difference between a command that succeeded, one that failed, one that was killed, and one that never finished. Keeping `exit_code`, `signal` and `timed_out` apart lets the tool report all four honestly, and keeping `truncated` apart means a reader can tell "no more output" from "no more room".

Four facts bound this interface. A result arrives once, at the end, so a long command shows nothing until it finishes. The request carries no environment, so a provider decides that on its own. The caller writes one command line rather than a program and its arguments. And `signal` is a name rather than a number, because whatever the platform reports is passed through as text.

-----

<a id="further-exploration"></a>
## Further exploration

- [pwsh-local](../pwsh-local/README.md): the provider that answers this capability today.
- [tool-pwsh](../tool-pwsh/README.md): the tool that renders a result for the model.
- [shell group](../README.md): how the three packages divide the work.
