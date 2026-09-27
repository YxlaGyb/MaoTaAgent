---
description: "The memory plugin: fixed-budget USER.md and MEMORY.md stores, the PreModel hook, and the model memory tool."
kind: "package-reference"
---

# memory

English | [中文](README.zh.md)

## Summary

This plugin provides `hook.memory` and `tool.memory`. The hook loads `USER.md` and the project's `MEMORY.md`, scans them, and contributes one bounded context entry before each model call. The tool adds, replaces, or removes entries by unique substring. A full store is an error with the current entries, never an automatic eviction.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The hook

| Method | Answer |
|---|---|
| `describe` | `{ events: ["PreModel"] }` |
| `PreModel` | One context entry in a main session, `null` in a subagent or when both stores are empty. |

### The tool

The `memory` tool accepts `target` (`user` or `memory`), one action (`add`, `replace`, `remove`), `content`, `old_text`, or an atomic `operations` batch.

### Storage and config

| Path | Meaning | Default limit |
|---|---|---|
| `$MAOTA_HOME/memories/USER.md` | User profile facts. | `1375` characters |
| `$MAOTA_HOME/memories/<project>/MEMORY.md` | Project and environment notes. | `2200` characters |

Entries use `\n§\n` as their delimiter. The config keys `user_char_limit` and `memory_char_limit` change the two limits. Writes use the shared file lock and atomic replacement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

A unique substring selects the entry for `replace` and `remove`; `replace` writes the complete new entry. The final batch result, not each intermediate step, is checked against the limit. External edits that cannot round-trip are refused and backed up. Unsafe content is rejected before persistence and replaced by a blocked notice if it reaches a load.

-----

<a id="further-exploration"></a>
## Further exploration

- [memory group](../README.md): why the hook and tool live together.
- [hooks](../../hooks/README.md): the event and the durable context note.