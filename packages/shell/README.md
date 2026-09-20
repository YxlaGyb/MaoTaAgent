---
description: "The shell group: the seam types a command runner answers to, the local PowerShell provider behind that capability, and the pwsh tool the model calls."
kind: "package-group"
---

# shell/: running commands

English | [中文](README.zh.md)

## Summary

Running a command is three packages on purpose. The library holds the request and result shapes and the one function that turns an exit status into a label, and it is imported rather than spawned. The provider answers the `shell` capability by actually starting PowerShell, and a sandboxed provider can replace it later without the tool noticing. The tool is the model-facing half: parameters, description and result rendering. Read this page to pick the right package, then open its directory for the contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Directory | Capability | Role |
|---|---|---|---|
| `@maota/shell` | [`shell`](shell/) |  | The library: `ShellRunRequest`, `ShellRunResult` and `parseExitStatus`. Imported by the other two and spawned by neither. |
| `@maota/pwsh-local` | [`pwsh-local`](pwsh-local/) | `shell` | The provider that runs a command with the local PowerShell. |
| `@maota/tool-pwsh` | [`tool-pwsh`](tool-pwsh/) | `tool.pwsh` | The tool the model is offered, named `pwsh`. |

The split exists so a second provider can answer the same capability. A sandboxed runner would provide `shell` with the same methods and the same result shape, `tool-pwsh` would go on calling `shell.run` unchanged, and only the profile's row list would change.

<a id="related-documentation"></a>
## Related documentation

- [pwsh-local](pwsh-local/README.md): how a command is actually started.
- [tool-pwsh](tool-pwsh/README.md): the contract of record for the `pwsh` tool.
- [tools](../../agent/tools/README.md): the dispatcher the tool plugin registers with.
- [packages group](../../README.md): the plugin tree this group belongs to.