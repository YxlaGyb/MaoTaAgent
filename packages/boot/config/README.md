---
description: "Resolve which config file and which kernel binary one maota launch uses, with the precedence the CLI documents."
kind: "package-reference"
---

# @virgena/maota-boot-config

English | [中文](README.zh.md)

## Summary

Decide the two inputs every launch needs: the config file to boot and the kernel binary to spawn. Both resolvers are pure path arithmetic over an options object, so a caller can inject a temporary repository root or a fake environment instead of the ambient one. Use it from any MaoTa entry point that launches a kernel; it never reads a config file, so it cannot tell you whether the chosen one is valid. The CLI is its only caller today.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Two functions, both taking their inputs as an options object:

```ts
import { resolveConfigPath, resolveKernelBin } from "../../boot/config/src/index.ts";

const config = resolveConfigPath({ explicit: flagValue }); // undefined falls back to the environment
const bin = resolveKernelBin({ explicit: flagValue });
```

### Precedence

| Input | Order, first match wins |
|---|---|
| Config file | `--config`, `EGGSHELL_CONFIG`, `<repo>/eggshell.local.toml` when it exists, `<repo>/eggshell.toml` |
| Kernel binary | `--kernel`, `EGGSHELL_BIN`, the installed `eggshell-kernel` binary, `<repo>/../eggshellmod/target/debug/eggshell.exe` |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals: click to expand</summary>

The module never reads a config file: layering (`extends`, later keys winning, tables merging per key, arrays replacing wholesale) belongs to the kernel loader. `repoRoot` walks up four levels from `src/`, so both resolvers work wherever they are imported from. `resolveKernelBin` imports the `eggshell-kernel` package for the installed binary path and accepts an `installed` override for tests.

| File | Contents |
|---|---|
| [`src/index.ts`](src/index.ts) | `repoRoot`, `resolveConfigPath`, `resolveKernelBin`, and the two option types |

</details>

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Resolving a path says nothing about whether the file is valid; the kernel's own `--check` is the only validation.
- The last kernel fallback hard-codes the Windows `.exe` suffix and the `debug` profile.
- There is no discovery of user-level configuration or `MAOTA_HOME`; session roots stay with the session plugin.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers: click to expand</summary>

None.

</details>
