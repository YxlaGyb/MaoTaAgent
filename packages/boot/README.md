---
description: "The boot package group: how one maota launch resolves its config and kernel binary, and how the Node host drives the eggshell kernel over stdio."
kind: "package-group"
---

# boot/

English | [中文](README.zh.md)

## Summary

MaoTa runs the eggshell kernel as a child process and talks to it over stdio; the boot group owns both halves of that launch. Read it when you are changing how a launch finds its config file or kernel binary, or how the Node side invokes capabilities, streams chunks, subscribes to events and shuts the kernel down. The group holds no plugin logic and never interprets plugin config values. It is a library family, not a plugin: nothing here is mounted into a kernel.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The CLI composes these two, and nothing else in the repository launches a kernel.

| Package | Role |
|---|---|
| [`config`](config/README.md) | Resolves the config file and the kernel binary for one launch. |
| [`host`](host/README.md) | Spawns the kernel, then invokes, streams, subscribes and shuts down over its stdio protocol. |

<a id="related-documentation"></a>
## Related documentation

- [maota CLI](../../apps/cli/README.md): the launcher that consumes both packages.
- [Architecture](../../docs/architecture.md): the component map and the launch path.

<a id="dev-note"></a>
## Dev Note

None.
