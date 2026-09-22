---
description: "The three file tools the model is offered: read with line numbers and a window, write that replaces or appends to a file, and edit that replaces literal text; their parameters, budgets, refusals and results."
kind: "package-reference"
---

# tool-fs

English | [中文](README.zh.md)

## Summary

One plugin, three capabilities: `tool.read`, `tool.write` and `tool.edit`, offered to the model as `read`, `write` and `edit`. Each is a thin shell over [`@maota/fs`](../fs/README.md): resolve the path inside the workspace, check the byte budget, do the work. A read is always safe to run beside another call and is never spilled; a write and an edit each run alone. The session working directory arrives as a host argument named `cwd`, so the model neither sees it nor can move it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### `read`

Read one UTF-8 text file with line numbers.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `file_path` | string | Yes | The file, relative to the working directory or absolute inside it. |
| `offset` | integer | No | The first line to read, counting from 1. |
| `limit` | integer | No | How many lines to read. 2000 by default. |
| `from_byte` | integer | No | Start the window at this byte instead of the beginning. The line numbers stay the file's own. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: the selected lines, each prefixed with its line number and a `|`. Two notes may follow in parentheses: that the file is larger than the byte cap, and which line to continue from. A window opened with `from_byte` reports how many lines the whole file has, not how many the window holds. Concurrency is `always` and the result is never spilled, so a long file always comes back in full or in a window the model chose.

### `write`

Write one UTF-8 text file, replacing it whole or appending to the end, and creating the parent directories.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `file_path` | string | Yes | The file, inside the working directory. |
| `content` | string | Yes | The text to write, or to append. |
| `mode` | string | No | `replace` writes the whole file, `append` adds to the end. `replace` by default. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: `{ path, bytes, created, mode }`, where `path` is the display path. Concurrency is `never`.

### `edit`

Replace literal text in one UTF-8 text file.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `file_path` | string | Yes | The file, inside the working directory. |
| `old_string` | string | Yes | The text to replace. It must appear exactly once unless `replace_all` is true. |
| `new_string` | string | Yes | The replacement text. |
| `replace_all` | boolean | No | Replace every occurrence. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: `{ path, replaced, bytes }`. Concurrency is `never`.

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_read_bytes` | `262144` | The most one read returns. It is a window, not a limit on what may be edited. |
| `max_write_bytes` | `1048576` | The largest text a write or an edit may produce. |
| `spill_dir` | `$MAOTA_HOME/tmp/tool-results` | The dispatcher's spill directory, added as a second root so `read` can open a spilled result. |

### Refusals

Every refusal is a `-32602`, so the loop hands the model an `{ error }` result and the turn continues.

| Refusal | When |
|---|---|
| `path ... is outside the working directory` | The path escapes the root, before or after real paths are taken. |
| `refusing to write through the link ...` | A write or an edit names a symbolic link. |
| `path ... is not usable: ...` | A null byte, an alternate data stream, or a segment ending in a dot or a space. |
| `no such file: ...` | A read or an edit names a file that is not there. A write creates it instead. |
| `... is a directory; use glob to list it` | A read names a directory. |
| `content is N bytes, over the M byte cap` | A write is over `max_write_bytes`. |
| `old_string appears N times in ...` | An edit matches more than once and `replace_all` is not true. |
| `old_string was not found in ...` | An edit matches nothing. |
| `offset N is past the M lines of ...` | A read starts beyond the end of the file. |
| `invalid arguments: arguments.cwd is required` | The host did not inject a working directory. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The three declarations, the config, and `selfCheck`. |
| [`src/read.ts`](src/read.ts) | The windowed, line-numbered read. |
| [`src/write.ts`](src/write.ts) | The whole-file or append write. |
| [`src/edit.ts`](src/edit.ts) | The unique-match and replace-all edit. |

### One definition, three capabilities

All three blueprints go through `defineTools`, so the published schema, the validation schema, the host argument and the safety policy are compiled once from one declaration each. `cwd` is declared with `host: "session_cwd"`, which keeps it out of the model's schema and makes it required at run time. The plugin answers `describe`, `policy`, `run` and `classify` for whichever capability the kernel addressed.

### Reading a window

A read stats the file, takes the smaller of its size and `max_read_bytes`, and reads that much into one buffer. It splits on `\r\n` or `\n`, drops a trailing empty line, then slices from `offset` for `limit` lines and pads each line number to the width of the last one. An unreadable tail and an unshown remainder are reported as the parenthesised notes rather than as errors, because both are normal on a long file.

### Editing safely

An edit walks the file in 64 KiB blocks, carrying a tail the length of `old_string` so a match that straddles a block boundary is still found. It counts the matches first and refuses when there are none, or when there is more than one and `replace_all` is not true, which is what stops a short string from rewriting the wrong place. The rewrite streams into a temporary file beside the target and is renamed over it, so the file is never left half replaced and the file is never held in memory whole.

Five facts bound these tools. A file in another encoding is read as replacement characters, because everything here is UTF-8, and a write is UTF-8 only. `write` either replaces the whole file or appends to it; there is no patch mode, so a change in the middle of a file goes through `edit`. A read takes `max_read_bytes` from `from_byte`, so with a byte offset a line past the cap is reachable, and the byte offset is the way past it. Writes and edits take a lock, in-process by path and cross-process through a `<file>.lock` beside the target, so two turns cannot interleave on one file. And `read` is the capability that may run beside other calls; `write` and `edit` each run alone.

-----

<a id="further-exploration"></a>
## Further exploration

- [fs](../fs/README.md): the workspace and atomic-write library these tools are built on.
- [tool-fs-search](../tool-fs-search/README.md): the `glob` tool that lists what `read` can open.
- [tools](../../agent/tools/README.md): the dispatcher that lists these three and injects `cwd`.
- [fs group](../README.md): how the library and the plugins divide the work.
