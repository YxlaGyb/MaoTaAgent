---
description: "The workspace library behind the file tools: what a working directory means, which paths are inside it, and how a file is written so a reader never sees half of it."
kind: "package-reference"
---

# fs

English | [中文](README.zh.md)

## Summary

This library holds the three questions every file tool has to answer before it touches anything: where the workspace root is, whether a path is inside it, and how to write without leaving a torn file behind. It is imported by the two file plugins and spawned by neither, so it reads no config and holds no state. Every refusal is a `CallError` with `-32602`, which means the model sees an argument-shaped problem rather than a crash.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

```ts
const space = workspace(cwd, spillDir);
const target = resolvePath({ path: args.file_path, roots: space.read_roots, write: true });
writeAtomic(target, content);
```

| Export | Input | Returns |
|---|---|---|
| `workspace(cwd, spillDir?)` | The session working directory, and optionally a second root to read from. | `{ root, read_roots }`. The root is the real path of `cwd`; `read_roots` is the root, plus the spill directory when one is given. |
| `existingRoot(dir)` | A directory. | Its real path. Fails when it is not a non-empty string, does not exist, or is not a directory. |
| `resolvePath({ path, roots, write? })` | A path to check, the roots it may land in, and whether this is a write. | The absolute target. Throws when the path is unusable or lands outside. |
| `displayPath(root, target)` | The root and an absolute target. | What the model should see: forward slashes, relative to the root, `.` for the root itself, and the canonical absolute path when the target is outside the root. |
| `writeAtomic(target, content)` | The file to write and its whole text. | Nothing. Creates the parent directories, writes a temporary file, then renames. |
| `withFileLock(path, work)` | The file a caller is about to touch, and the work to do under the lock. | A promise of what `work` returned. Queues behind any other caller for the same path, here and in another process. |
| `pendingFileLocks()` | Nothing. | How many callers are waiting on or holding a lock right now. |

### What `resolvePath` refuses

| Input | Why |
|---|---|
| A null byte | The filesystem cannot carry it. |
| A colon past the drive letter | It would name an alternate data stream. |
| A segment ending in a dot or a space | Windows strips it, so two paths would mean one file. |
| A relative path that climbs out with `..` | The result is not inside any root. |
| An absolute path outside every root | Same check, before any real path is taken. |
| A path whose deepest existing ancestor is outside | A link inside the root cannot be used to reach outside it. |
| A symbolic link as the target of a write | Writing through a link would place the file somewhere else. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/paths.ts`](src/paths.ts) | `Workspace`, `existingRoot`, `workspace`, `resolvePath` and `displayPath`. |
| [`src/atomic.ts`](src/atomic.ts) | `writeAtomic`. |
| [`src/lock.ts`](src/lock.ts) | `withFileLock`, `pendingFileLocks`, and the lock file a second host honours. |
| [`src/index.ts`](src/index.ts) | Re-exports. |

### Containment is checked twice

`resolvePath` first compares the joined path against each root with `path.relative`: a result of `..` or an absolute path means outside. It then takes the deepest ancestor of the target that exists, resolves that with `realpath`, and repeats the same comparison. The second pass is what stops a link from carrying a path out of the workspace, and taking the deepest existing ancestor rather than the whole path is what lets a write name a file that does not exist yet.

### Writing so a reader never sees half a file

`writeAtomic` creates a temporary file next to the target, named `.<name>.<uuid>.tmp`, with the exclusive-create flag and mode `0600`, writes the whole text, and renames it onto the target. A rename on one volume is atomic, so a reader sees either the old file or the new one. A failed rename removes the temporary file and rethrows.

Five facts bound this module. A write refuses a symbolic link, and a junction that already resolved outside the root is caught by the containment pass rather than by a check of its own. `displayPath` shows a target outside the root as its canonical absolute self, because a relative answer would name something nobody could open. `writeAtomic` assumes one volume, because the temporary file is a sibling of the target, which is what makes the rename atomic. `writeAtomic` takes no lock of its own: a caller that wants one writer at a time asks `withFileLock`, which is what every file write in this tree does. And the mode bits are advisory on Windows, where `0600` and `0700` are applied only where the platform honours them.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-fs](../tool-fs/README.md): the three tools built on this library.
- [tool-fs-search](../tool-fs-search/README.md): the search tool that scopes itself with `resolvePath`.
- [fs group](../README.md): how the library and the plugins divide the work.
