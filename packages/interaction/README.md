---
description: "The interaction group: the permission gate a tool asks before it acts, what a decision looks like, and where it is written down."
kind: "package-group"
---

# interaction/: asking before acting

English | [中文](README.zh.md)

## Summary

One package sits here: the gate a tool asks before it does something destructive. It is a plugin like any other, so the kernel routes `permission` without knowing what a tool or a command is, and a deployment that never mounts it refuses every flagged operation instead of approving it. Read this page to see what the group answers, then open the directory for the contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Directory | Capability | Role |
|---|---|---|---|
| `@maota/permission` | [`permission`](permission/) | `permission` | The gate: the session's mode, the questions waiting for an answer, and the paired audit file. |

The split is between asking and deciding. A tool owns the judgement that an operation deserves a question, because only the tool knows what its arguments do; the gate owns the mode, the waiting and the record. A second responder, such as a policy engine or a desktop prompt, can therefore answer in place of the web card without the tool changing: it registers itself, and `tool-pwsh` goes on reading the same four outcome words.

<a id="related-documentation"></a>
## Related documentation

- [permission](permission/README.md): the contract of record for the gate.
- [Permission design](../../docs/permission.md): where the gate sits, the three modes, and what it leaves out.
- [shell group](../shell/README.md): the tool that asks.
- [packages group](../README.md): the plugin tree this group belongs to.
