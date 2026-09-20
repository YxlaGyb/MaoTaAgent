---
description: "The glob tool: find files by path pattern below the working directory, with the pattern syntax it accepts, the ordering and cap on its results, and its link policy."
kind: "package-reference"
---

# tool-fs-search

English | [中文](README.zh.md)

## Summary

One capability, `tool.glob`, offered to the model as `glob`. It walks a directory tree, matches each file path against a pattern, and returns the matching paths sorted. It never reads a file, never writes one, and never follows a symbolic link unless `follow_links` says so. Because it only walks, it is safe to run beside another call. The session working directory arrives as the host argument `cwd`, and the search can be narrowed further with an optional `path`.

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

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_glob_results` | `200` | The most paths one glob returns. |
| `follow_links` | `false` | Whether a symbolic link is descended into or listed. |

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the config and `selfCheck`. |
| [`src/glob.ts`](src/glob.ts) | `patternToRegExp` and `globFiles`. |

### A pattern becomes one anchored expression

`patternToRegExp` walks the pattern character by character and builds a regular expression anchored at both ends. `**/` becomes `(?:[^/]+/)*`, which is what lets a leading `**` match nothing at all, while a bare `**` becomes `.*`. Everything else is escaped, so a dot in a pattern is a dot and not any character.

### The walk

`globFiles` starts a stack with the search directory and pops it until it is empty. Each entry is classified first, and a symbolic link is dropped unless `follow_links` is true, which is what stops a link from turning a bounded walk into a loop. Directories are pushed for later and files are matched, and a match outside the search directory is kept as the path relative to the workspace root. The list is sorted at the end. Two things stop the walk early: reaching `max_glob_results` and visiting more than fifty thousand entries, and either one sets `truncated`.

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

- **No content search**: only paths are matched, so finding a string in a file needs a read or a command.
- **No ignore file**: nothing reads `.gitignore`, so a walk sees build output and vendored trees alike.
- **No negation and no brace expansion**: `!` and `{a,b}` are literal characters.
- **A hidden file is not special**: dotfiles match like any other name.
- **Case sensitivity follows the platform**: the matcher itself is case-sensitive, so a Windows tree can still be walked with a pattern that does not match its casing.