---
description: "Resolve which config file and which kernel binary one maota launch uses, and generate the per-user config on a first run."
kind: "package-reference"
---

# @virgena/maota-boot-config

English | [中文](README.zh.md)

## Summary

Decide the two inputs every launch needs: the config file to boot and the kernel binary to spawn. Config lives in `MAOTA_HOME` (default `~/.maota`); the first run writes a packaged default there, and an `eggshell.local.toml` beside it wins over that generated file. Both resolvers are pure path arithmetic over an options object, so a caller can inject a temporary home or a fake environment instead of the ambient one. Use it from any MaoTa entry point that launches a kernel; it never reads a config file, so it cannot tell you whether the chosen one is valid. The CLI is its only caller today.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use these helpers from any entry point that has to decide which config file to boot and which kernel binary to spawn: resolve once, then hand both paths to the host. None of them reads a config file, so a resolved path says nothing about whether that file is valid.

### Resolving the two inputs

```ts
import { resolveConfigPath, resolveKernelBin, maotaHome } from "../../boot/config/src/index.ts";

const home = maotaHome();
const config = resolveConfigPath({ explicit: flagValue });
const bin = resolveKernelBin({ explicit: flagValue });
```

### Precedence

| Input | Order, first match wins |
|---|---|
| Config file | `--config`, `EGGSHELL_CONFIG`, `<home>/eggshell.local.toml` when it exists, `<home>/eggshell.toml`: written from the packaged default when it is missing |
| Home | `MAOTA_HOME`, else `~/.maota` |
| Kernel binary | `--kernel`, `EGGSHELL_BIN`, the installed `eggshell-kernel` binary, `<repo>/../eggshellmod/target/debug/eggshell.exe` |

An explicit `--config` and an injected `root` both suppress the write: with either, a missing file stays missing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

This section explains how the two resolvers work; the inputs they accept are covered in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `repoRoot`, `maotaHome`, `writeDefaultConfig`, `resolveConfigPath`, `resolveKernelBin` and the option types |
| [`eggshell.default.toml`](eggshell.default.toml) | The plugin set a fresh home starts with: `{{repo}}` placeholders and the hmr row shipped disabled |

### First-run generation

The module never reads a config file: layering (`extends`, later keys winning, tables merging per key, arrays replacing wholesale) belongs to the kernel loader. `writeDefaultConfig` copies `eggshell.default.toml` with every `{{repo}}` replaced by the absolute repository path, so the entry points keep working once the file is copied elsewhere; it writes `MaoTa: wrote <path>` to stderr and never overwrites a file that already exists. `repoRoot` walks up four levels from `src/`, so both resolvers work wherever they are imported from. `resolveKernelBin` imports the `eggshell-kernel` package for the installed binary path and accepts an `installed` override for tests.

-----

<a id="further-exploration"></a>
## Further exploration

- [boot group](../README.md): the launch glue these resolvers belong to.
- [maota CLI](../../../apps/cli/README.md): the only caller, and the flags that feed both resolvers.
- [Architecture](../../../docs/architecture.md#configuration-layering): how the generated file and the machine layer stack.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

These limits say when this package needs care. They are current constraints, not a task backlog.

- **Resolution is not validation**: the kernel's own `--check` is the only thing that says a config is valid.
- **The last kernel fallback is Windows-shaped**: it hard-codes the `.exe` suffix and the `debug` profile.
- **A generated config is frozen at generation time**: a newer packaged default does not update an existing `<home>/eggshell.toml`.
- **No settings or credential layer yet**: session roots still belong to the session plugin.
