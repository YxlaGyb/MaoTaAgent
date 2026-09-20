---
description: "The tools capability: the registry every tool plugin is discovered through, the list, call and classify methods the agent talks to, and the result budget that spills to disk."
kind: "package-reference"
---

# tools/

English | [中文](README.zh.md)

## Summary

The agent never calls a tool plugin directly. It calls this dispatcher, which discovers every capability named `tool.*` out of the capabilities the kernel published, sorts them by name, and answers three methods: `list` for the specs the model sees, `call` for the work, and `classify` for whether a call may run beside another. It holds one local fact per tool, the policy it read once during `list`, and it owns the result budget: an answer too large to hand to the model is written to disk and replaced by a preview plus a path.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### The methods

| Method | Params | Returns |
|---|---|---|
| `list` | none | `{ tools }`, one spec per tool, sorted by name. Each spec carries `name`, `description`, `input_schema`, `host_args` and the `capability` it came from. |
| `call` | `{ name, args }` | The tool's own result, or the spill envelope when it is over budget. An unknown name is a `-32602`. |
| `classify` | `{ name, args }` | `{ safe }`. An unknown name is a `-32602`; a tool with no policy is `false`. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_result_chars` | `20000` | The budget for a tool that declares none. A returned string is measured in characters. |
| `preview_chars` | `2000` | How much of a spilled result comes back inline. |
| `spill_dir` | `$MAOTA_HOME/tmp/tool-results` | Where spilled results are written. |

### The spill envelope

Over budget, `call` writes the whole answer and returns `{ spilled: true, path, chars, preview }`. The directory is created `0700` and the file `0600` under a random name, exclusive create. The model can then read the file with the `read` tool, which is why the two plugins declare the same `spill_dir`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/registry.ts`](src/registry.ts) | `TOOL_PREFIX`, `ToolRoute`, `discover` and `sorted`. |
| [`src/index.ts`](src/index.ts) | The definition: config, discovery at `start`, the three methods, the budget and the spill. |

### Discovery

`discover` walks the capability table the kernel handed over at `start` and keeps every name that starts with `tool.`, minus the prefix, skipping an empty remainder. The one fact a route carries beyond its name is `policy`, which starts as `null` and is filled by `list`. A tool that does not answer `describe` or `policy` is logged and left out rather than failing the list.

### Safety is asked, not assumed

`classify` reads the cached policy. `"always"` answers `true` and `"never"` answers `false` without a round trip. A policy of `"args"` forwards to the tool's own `classify`, and any failure, a missing policy, or an answer that is not strictly `true` becomes `false`. The loop applies the same rule, so an unclassified call runs alone.

### The self check

`selfCheck` covers the pure parts: discovery picks only `tool.*` names, `sorted` orders them, an undeclared budget falls back to `max_result_chars`, `null` means never spill, and a spill writes the whole text under `spill_dir` with the recorded char count.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-fs](../fs/tool-fs/README.md): the `tool.read`, `tool.write` and `tool.edit` capabilities this dispatcher discovers.
- [agent-core](agent-core/README.md): the caller that lists these tools and injects their host arguments.
- [plugin-kit](../plugin-kit/README.md): `defineTools`, the declaration shape these routes answer.
- [agent package](README.md): the group this dispatcher belongs to.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **`list` is the only discovery**: a tool plugin that joins later is not noticed until the next list.
- **One policy cache**: a policy read at `list` time is never refreshed.
- **The budget measures text**: a string is counted as characters and anything else as its JSON rendering, so a large object can spill on its encoding rather than its content.
- **Spilled files are never cleaned up**: nothing deletes an old spill.
- **No permission layer**: the dispatcher routes by name and checks no access.