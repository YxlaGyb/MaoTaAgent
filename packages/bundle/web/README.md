---
description: "The web bundle: the single row the serve profile adds to the base set, and what changes when it is mounted."
kind: "package-reference"
---

# web bundle

English | [中文](README.zh.md)

## Summary

This package holds one row. It exists so that the `serve` profile can mount the web front end without the `default` profile knowing it exists: `base` names the eleven plugins every launch needs, and this bundle adds the twelfth only where a browser is going to connect. The package name is `@maota/web-bundle` while the directory is `bundle/web`, because `web-bundle` says what it is and `web` says which profile it belongs to.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { rows } from "@maota/web-bundle";
```

| Export | Shape | Meaning |
|---|---|---|
| `rows` | `PluginRow[]` | One row, in mount order. |
| `PluginRow` | `{ id, name, disabled?, config? }` | One row. `id` is the key the config block and the log lines use, and `name` is the package to spawn. |

### The row

| id | Package | Capability |
|---|---|---|
| `web` | `@maota/web` | `web` |

### What mounting it changes

| Before | After |
|---|---|
| Two profiles, both mounting `base` only. | `serve` mounts `base` and then this bundle, so one more row appears. |
| The HTTP front end is not resolvable from a profile directory. | `@maota/web` is linked in and started with the rest. |

Nothing else about the launch changes: the generated config gains one block, and `default` is untouched.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/rows.ts`](src/rows.ts) | `PluginRow` and the single `rows` entry. |
| [`src/index.ts`](src/index.ts) | Re-exports. |

### Why a bundle and not a flag

A bundle is a package, so `serve` can name it in `package.json` under `maota.profile.bundles` and the launcher resolves it the same way it resolves `base`. A flag in the launcher would put the decision in code rather than in the profile, and a row appended in code would be invisible to `pnpm check:plugins`, which walks the bundle lists to find the entries it should check.

One row and no config: the port, whether it is a development server and every other setting belong to the user's local config layer. A bundle only adds rows, so a profile that wants fewer plugins than `base` needs a bundle of its own. And running the CLI without the serve profile gives no hint that a web front end exists.

-----

<a id="further-exploration"></a>
## Further exploration

- [base](../base/README.md): the row list this bundle is added to.
- [bundle group](../README.md): what a row list is.
- [web front end](../../../apps/web/README.md): the package this row spawns, which sits outside the packages tree.
