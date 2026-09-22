---
description: "The search tools: find files by path pattern and matching lines by regular expression below the working directory, with the pattern syntax, the ordering and the caps on what comes back."
kind: "package-reference"
---

# tool-fs-search

English | [中文](README.zh.md)

## Summary

Two capabilities, `tool.glob` and `tool.grep`, offered to the model as `glob` and `grep`. Both walk the same directory tree and neither writes anything: `glob` matches each file path against a pattern and returns the matching paths sorted, and `grep` reads each file the walk reaches and returns the lines a regular expression matches, grouped by file. Neither follows a symbolic link unless `follow_links` says so, and both are safe to run beside another call. The session working directory arrives as the host argument `cwd`, and either search can be narrowed further with an optional `path`. Both read the `.gitignore` files they walk past, so a search sees the tree a person would see rather than one full of build output.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### `glob`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `pattern` | string | Yes | Matched against each path below the search directory. A leading `!` negates it and `{a,b}` offers alternatives. |
| `path` | string | No | The directory to search, relative to the working directory. The whole tree by default. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: `{ pattern, path, count, truncated, incomplete, skipped, files }`, where `path` is the display path of the directory that was searched, `files` holds the matches in sorted order, `truncated` says the cap cut the list short, `incomplete` says the walk itself stopped early, and `skipped` counts the entries that never reached the matcher: a `.gitignore` rule, a hidden name, or a link the policy does not follow. Concurrency is `always`.

### `grep`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `pattern` | string | Yes | A regular expression, matched against each line on its own. |
| `path` | string | No | The directory to search, relative to the working directory. The whole tree by default. |
| `include` | string[] | No | Globs a file's path must match at least one of, such as `["**/*.ts", "**/*.tsx"]`. |
| `multiline` | boolean | No | Test the pattern against the whole file instead of one line at a time, so a hit may cross a line break. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Result: `{ pattern, path, count, truncated, incomplete, skipped, matches, text }`. `text` is what the model reads: each file that matched is named once, on its own line, and every match under it follows as `  Line N: <the line>`, ordered by path and then by line number, with the reasons a search fell short appended in parentheses, as in `(stopped at the max_matches of 250, so 12 more matches are not shown)`. `matches` carries the same hits as records, and `truncated`, `incomplete` and `skipped` carry the counts that sentence talks about. Concurrency is `always`.

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
| `!` at the front | The whole pattern negated, so `!**/*.md` matches every path that is not a markdown file. |
| `{a,b}` | Either alternative, so `src/{tool,agent}/*.ts` matches either directory. |

Every other character is literal, and a backslash in a pattern is read as a separator, so a Windows-shaped pattern behaves like a forward-slash one. A name that starts with a dot is left out of a walk unless the pattern names a hidden segment itself, which is why `**/*.ts` never reports `.config.ts` while `**/.*` does.

### Refusals

| Refusal | When |
|---|---|
| `pattern must be a non-empty string` | The pattern is missing or blank. |
| `path ... is outside the working directory` | The scope escapes the workspace. |
| `no such directory: ...` | The scope does not exist. |
| `... is not a directory` | The scope is a file. |
| `pattern must be a non-empty string` | A grep pattern is missing or blank. |
| `pattern is not a usable regular expression: ...` | A grep pattern does not compile. |
| `include must be a glob pattern, or a list of them` | `include` carries something that is not a pattern, or a list holding one. |
| `include cannot negate; pass positive glob patterns` | An `include` pattern starts with `!`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the config and `selfCheck`. |
| [`src/walk.ts`](src/walk.ts) | The shared walk: `searchBase`, `walkFiles`, the link policy, the hidden-name policy and the entry cap. |
| [`src/ignore.ts`](src/ignore.ts) | The `.gitignore` reader: the rules one file declares, and the decision over all of them. |
| [`src/glob.ts`](src/glob.ts) | `globFiles`: the path matcher and its ordering. |
| [`src/grep.ts`](src/grep.ts) | `grepFiles`: the line matcher, the file budget and the rendering. |

### A pattern becomes one anchored expression

`patternToRegExp` walks the pattern character by character and builds a regular expression anchored at both ends. `**/` becomes `(?:[^/]+/)*`, which is what lets a leading `**` match nothing at all, while a bare `**` becomes `.*`; `{a,b}` becomes an alternation, and a leading `!` turns the whole thing into a negative lookahead over an unanchored `[\\s\\S]*`. Everything else is escaped, so a dot in a pattern is a dot and not any character. The function lives in `plugin-kit`, because the skill registry matches `paths` with the same rules.

### The walk

`walkFiles` starts a stack with the search directory and pops it until it is empty, handing every file it reaches to its caller as a full path and a path relative to the workspace root. Each entry is classified first, and a symbolic link is dropped unless `follow_links` is true, which is what stops a link from turning a bounded walk into a loop. Directories are pushed for later, and visiting more than fifty thousand entries stops the walk and reports how many were visited. Entering a directory also reads the `.gitignore` in it, and the rules collected so far decide every entry below: a rule keeps a path out, a later `!` can bring it back, and everything the walk turns away — ignored, hidden, or a link it will not follow — is counted instead of silently missing. `searchBase`, the link policy, the hidden-name policy and that entry cap therefore live in one file, so the two tools cannot disagree about what a scope means or where a walk may go.

### What grep does with one file

`readBounded` stats the file first and gives up on anything over `max_file_bytes`, then reads it in one go; a body carrying a NUL byte counts as binary. Both cases are skipped and counted rather than searched, which is why a note can say how many files were left out. The body is split on line breaks and every line is tested on its own, unless `multiline` asks for the whole file at once, in which case each match is located by a binary search over the line starts and its text is folded onto one line so it still reads as a single hit. Matches are kept until `max_matches`, after which the rest are counted so the note can report them. A line over `max_line_chars` is clipped without splitting a surrogate pair, and the display path of each file is what the caller sees, never the absolute one.

`walkFiles` sorts nothing: `globFiles` sorts its list of paths, and `grepFiles` sorts its matches by path and line, so each tool owns the order it promises.

Six facts bound a search. The ignore files are the ones a walk passes through: a rule is read where it was written, and a `.gitignore` above the search directory is not consulted. A file over `max_file_bytes`, or one carrying a NUL byte, is left out and counted rather than failing the call, so a search can miss a match and still look like it succeeded. `include` is a list of positive globs, and a negating one is refused rather than interpreted. Hidden names are out of the walk unless the pattern names one, and an ignored directory is pruned whole, so `skipped` counts what was left out and not how many files lived under it. The matcher follows the platform: case-insensitive on Windows, case-sensitive everywhere else.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-fs](../tool-fs/README.md): the `read` tool to open whatever this one found.
- [fs](../fs/README.md): the `resolvePath` and `displayPath` this tool scopes itself with.
- [tools](../../agent/tools/README.md): the dispatcher that lists this capability.
- [fs group](../README.md): how the library and the plugins divide the work.
