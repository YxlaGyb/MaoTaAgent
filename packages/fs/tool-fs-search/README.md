---
description: "The search tools: find files by path pattern and matching lines by regular expression below the working directory, with the pattern syntax, the ordering and the caps on what comes back."
kind: "package-reference"
---

# tool-fs-search

English | [中文](README.zh.md)

## Summary

Two capabilities, `tool.glob` and `tool.grep`, offered to the model as `glob` and `grep`. Both walk the same directory tree and neither writes anything: `glob` matches each file path against a pattern and returns the matching paths sorted, and `grep` reads each file the walk reaches and returns the lines a regular expression matches, grouped by file. Neither follows a symbolic link unless `follow_links` says so, and both are safe to run beside another call. The session working directory arrives as the host argument `cwd`, and either search can be narrowed further with an optional `path`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### `glob`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `pattern` | string | Yes | Matched against each path below the search directory. |
| `path` | string | No | The directory to search, relative to the working directory. The whole tree by default. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: `{ pattern, path, count, truncated, files }`, where `path` is the display path of the directory that was searched, `files` holds the matches in sorted order, and `truncated` says whether the cap or the walk limit cut the list short. Concurrency is `always`.

### `grep`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `pattern` | string | Yes | A regular expression, matched against each line on its own. |
| `path` | string | No | The directory to search, relative to the working directory. The whole tree by default. |
| `include` | string | No | One positive glob that a file's path must match, such as `**/*.ts`. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: text. Each file that matched is named once, on its own line, and every match under it follows as `  Line N: <the line>`, ordered by path and then by line number. A search that found nothing says where it looked and quotes the pattern back, and a search that was cut short appends the reasons in parentheses, as in `(stopped at the max_matches of 250, so 12 more matches are not shown)`. Concurrency is `always`.

An unusable pattern is an error rather than an empty answer, and the diagnostic is the regular expression engine's own, so `no matches` always means the expression compiled and matched nothing.

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_glob_results` | `200` | The most paths one glob returns. |
| `follow_links` | `false` | Whether a symbolic link is descended into or listed. |
| `max_matches` | `250` | The most matches one grep returns. The rest are counted and reported. |
| `max_line_chars` | `2000` | The most characters of one matching line, clipped on a character boundary with a trailing ellipsis. |
| `max_file_bytes` | `1048576` | The largest file grep reads. A bigger one is skipped and counted. |

### Pattern syntax

| In a pattern | Matches |
|---|---|
| `?` | Exactly one character, never a path separator. |
| `*` | Any run of characters except a path separator. |
| `**` | Any run of characters, separators included. |
| `**/` | Zero or more whole segments, so `**/*.ts` matches a file at the root. |

Every other character is literal, and a backslash in a pattern is read as a separator, so a Windows-shaped pattern behaves like a forward-slash one.

### Refusals

| Refusal | When |
|---|---|
| `pattern must be a non-empty string` | The pattern is missing or blank. |
| `path ... is outside the working directory` | The scope escapes the workspace. |
| `no such directory: ...` | The scope does not exist. |
| `... is not a directory` | The scope is a file. |
| `pattern must be a non-empty string` | A grep pattern is missing or blank. |
| `pattern is not a usable regular expression: ...` | A grep pattern does not compile. |
| `include takes one glob pattern, not a comma list` | `include` carries more than one pattern. |
| `include cannot negate; pass one positive glob pattern` | `include` starts with `!`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the config and `selfCheck`. |
| [`src/walk.ts`](src/walk.ts) | The shared walk: `patternToRegExp`, `searchBase` and `walkFiles`. |
| [`src/glob.ts`](src/glob.ts) | `globFiles`: the path matcher and its ordering. |
| [`src/grep.ts`](src/grep.ts) | `grepFiles`: the line matcher, the file budget and the rendering. |

### A pattern becomes one anchored expression

`patternToRegExp` walks the pattern character by character and builds a regular expression anchored at both ends. `**/` becomes `(?:[^/]+/)*`, which is what lets a leading `**` match nothing at all, while a bare `**` becomes `.*`. Everything else is escaped, so a dot in a pattern is a dot and not any character.

### The walk

`walkFiles` starts a stack with the search directory and pops it until it is empty, handing every file it reaches to its caller as a full path and a path relative to the workspace root. Each entry is classified first, and a symbolic link is dropped unless `follow_links` is true, which is what stops a link from turning a bounded walk into a loop. Directories are pushed for later, and visiting more than fifty thousand entries stops the walk and reports how many were visited. `patternToRegExp`, `searchBase`, the link policy and that entry cap therefore live in one file, so the two tools cannot disagree about what a scope means or where a walk may go.

### What grep does with one file

`readBounded` stats the file first and gives up on anything over `max_file_bytes`, then reads it in one go; a body carrying a NUL byte counts as binary. Both cases are skipped and counted rather than searched, which is why a note can say how many files were left out. The body is split on line breaks, every line is tested on its own, and matches are kept until `max_matches`, after which the rest are counted so the note can report them. A line over `max_line_chars` is clipped without splitting a surrogate pair, and the display path of each file is what the caller sees, never the absolute one.

`walkFiles` sorts nothing: `globFiles` sorts its list of paths, and `grepFiles` sorts its matches by path and line, so each tool owns the order it promises.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-fs](../tool-fs/README.md): the `read` tool to open whatever this one found.
- [fs](../fs/README.md): the `resolvePath` and `displayPath` this tool scopes itself with.
- [tools](../../agent/tools/README.md): the dispatcher that lists this capability.
- [fs group](../README.md): how the library and the plugins divide the work.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No ignore file**: nothing reads `.gitignore`, so a walk sees build output and vendored trees alike.
- **No negation and no brace expansion**: `!` and `{a,b}` are literal characters.
- **A skip is not a failure**: a file over `max_file_bytes`, or one carrying a NUL byte, is left out and counted in the note, so a search can miss a match and still look like it succeeded.
- **A match is one line**: the pattern is tested against a line at a time, so nothing can match across a line break.
- **`include` is one glob**: several patterns in one call, or a pattern that negates, are refused rather than interpreted.
- **A hidden file is not special**: dotfiles match like any other name.
- **Case sensitivity follows the platform**: the matcher itself is case-sensitive, so a Windows tree can still be walked with a pattern that does not match its casing.
