---
description: "The fs group: the workspace library the file tools share, the read, write and edit tools, and the glob search tool."
kind: "package-group"
---

# fs/: file access

English | [中文](README.zh.md)

## Summary

Reading, writing and searching files is three packages: one library that decides what a path may mean, and two plugins that turn that library into model-facing tools. The library holds the workspace root, the containment rules and the atomic write, and it is imported rather than spawned. The plugins are spawned, answer `tool.read`, `tool.write`, `tool.edit`, `tool.glob` and `tool.grep`, and know nothing about each other. Read this page to pick the right package, then open its directory for the contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Directory | Capability | Role |
|---|---|---|---|
| `@maota/fs` | [`fs`](fs/) |  | The library: the workspace root, path containment, the display path and the atomic write. Imported by both plugins and spawned by neither. |
| `@maota/tool-fs` | [`tool-fs`](tool-fs/) | `tool.read`, `tool.write`, `tool.edit` | The plugin the model reads files, writes files and edits files through. |
| `@maota/tool-fs-search` | [`tool-fs-search`](tool-fs-search/) | `tool.glob`, `tool.grep` | The plugin that finds files by path pattern and matching lines by regular expression. |

The read-only and the writing tools live in one package, and the search tool lives in another, because a search only walks a tree while a write mutates it. Neither plugin imports the other, and both import `@maota/fs`.

<a id="related-documentation"></a>
## Related documentation

- [tool-fs](tool-fs/README.md): the contract of record for the three file tools.
- [tools](../../agent/tools/README.md): the dispatcher both plugins are discovered through.
- [packages group](../../README.md): the plugin tree this group belongs to.
