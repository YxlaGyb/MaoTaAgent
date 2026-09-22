---
name: plugin-authoring
description: MaoTa project only: add or change a MaoTa plugin package, its manifest shape, the plugin-kit definition, capability names, bundle rows, and the checks it has to pass.
when-to-use: When the working directory is a MaoTa checkout and the user adds a plugin, changes what a plugin provides, or wires a new package into a bundle.
paths:
  - packages/**
---

# Authoring a plugin (MaoTa)

This skill is about the MaoTa repository and its plugin system. The words
"plugin", "capability" and "bundle row" below mean MaoTa's own, not a general
plugin API, and nothing here applies to another project that happens to use
packages.

Everything in this repository that the kernel can spawn is a package under
`packages/<group>/<pkg>/` with a `package.json` and a `src/index.ts`. The kernel
resolves the package name from the profile's own `node_modules`, spawns it, and
never imports it: a plugin talks to the rest of the deployment over capabilities
only.

## The three files that matter

```
packages/<group>/<pkg>/package.json    name, main: lib/index.js, exports
packages/<group>/<pkg>/src/index.ts    runPlugin(definition)
packages/<group>/README.md             the group map, when the group is new
```

`pnpm build` (tsdown) writes `lib/index.js`, which is what the manifest points at.
`lib/` is not committed.

## The definition

```
export const definition: Definition = {
  provides: [{ capability: "tool.thing", version: "1.0.0" }],
  configKeys: ["dir"],
  requires: [{ capability: "fs", version: "^1", optional: true }],
  setup(wiring) {},
  start(wiring) {},
  methods: { async run(params, ctx) {} },
  async selfCheck() { return []; },
};

runPlugin(definition);
```

- `provides` is the whole registration. A capability name is
  `<domain>` for an engine, `tool.<name>` for something the model calls, and
  `context.<name>`, `hook.<name>` or `skill.<name>` for a pluggable slot.
- `setup` reads `wiring.config` and must default every key it accepts.
- `start` reads `wiring.capabilities` **once**, and the table it is handed is the
  whole deployment, so row order in the bundle is not load bearing. A plugin
  that wants to notice a provider arriving later subscribes to
  `kernel.capabilities.changed` and rebuilds from that payload.
- `methods` are the RPC surface. Invalid arguments throw
  `CallError(-32602, ...)`; a missing capability is not an error the caller
  should have to catch.
- Reach another plugin only through `ctx.channel.call`, `ctx.channel.stream`, or
  `ctx.channel.publish`. Never import another plugin's module.

## Wiring it in

Add a row to `packages/bundle/base/src/rows.ts` in the position its dependencies
demand, and add the package to the root `package.json` devDependencies so the
profile links it. Then run:

```
pnpm check:plugins     # every row starts and reports its capabilities
pnpm build && pnpm check
```

`pnpm check:plugins` runs each entry with `--check`, which calls `selfCheck`
with no kernel, so a broken default or an unreadable config key is caught there
rather than in a live session.

## Boundaries

This repository validates at parser, config, queue, model JSON, durable file,
worker, process and wire boundaries, and trusts types inside one process. Add a
check when a value crosses one of those lines; do not add fallbacks for values
the static interface already guarantees.
