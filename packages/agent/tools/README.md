---
description: "The tools capability: the registry every tool plugin is discovered through, the list, call and classify methods the agent talks to, and the result budget that spills to disk."
kind: "package-reference"
---

# tools/

English | [中文](README.zh.md)

## Summary

The agent never calls a tool plugin directly. It calls this dispatcher, which discovers every capability named `tool.*` out of the capabilities the kernel published, sorts them by name, and answers three methods: `list` for the specs the model sees, `call` for the work, and `classify` for whether a call may run beside another. It keeps no cache of its own: the pool is rebuilt whenever the kernel announces a changed table, and a tool's policy is read again on each call. It owns the result budget: an answer too large to hand to the model is written to disk and replaced by a preview plus a path, and that directory is swept as it fills.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

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
| `spill_max_age_ms` | `86400000` | How old a spilled result may be before a sweep deletes it. |
| `spill_max_bytes` | `67108864` | How much the spill directory may hold before a sweep deletes oldest first. |

### The spill envelope

Over budget, `call` writes the whole answer and returns `{ spilled: true, path, chars, preview }`. The directory is created `0700` and the file `0600` under a random name, exclusive create. The model can then read the file with the `read` tool, which is why the two plugins declare the same `spill_dir`. Before it writes, it sweeps: anything older than `spill_max_age_ms` is deleted, then the oldest files go until what remains fits `spill_max_bytes`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/registry.ts`](src/registry.ts) | `TOOL_PREFIX`, `ToolRoute`, `discover` and `sorted`. |
| [`src/index.ts`](src/index.ts) | The definition: config, discovery at `start`, the three methods, the budget and the spill. |

### Discovery

`discover` walks a capability table and keeps every name that starts with `tool.`, minus the prefix, skipping an empty remainder. The pool is built at `start` and rebuilt whenever the kernel publishes `kernel.capabilities.changed`, so a tool plugin mounted, restarted or dropped after start is noticed without restarting the dispatcher. A tool that does not answer `describe` is logged and left out rather than failing the list.

### Safety is asked, not assumed

`classify` reads the policy for this call rather than one remembered from a list. `"always"` answers `true` and `"never"` answers `false` without a further round trip. A policy of `"args"` forwards to the tool's own `classify`, and any failure, a missing policy, or an answer that is not strictly `true` becomes `false`. The loop applies the same rule, so an unclassified call runs alone.

### The self check

`selfCheck` covers the parts that are cheap to reach: discovery picks only `tool.*` names, `sorted` orders them, a pool rebuilt from an empty table is empty, an undeclared budget falls back to `max_result_chars`, `null` means never spill, a spill writes the whole text under `spill_dir` with the recorded char count, and a sweep drops what is past its age and trims the rest to the byte cap.

Five facts bound this dispatcher. The budget measures text, counting a string as characters and anything else as its JSON rendering, so a large object can spill on its encoding rather than its content. The sweep runs before a write and not on a timer, so a directory nobody spills into again is left exactly as it was. A spilled result is a plain file under `spill_dir`, mode `0600`, so every result a session ever spilled stays readable to the process until the sweep takes it. A tool's arguments are passed through untouched, so what a tool accepts and refuses is its own business. And the dispatcher routes by name and checks no access, because there is no permission layer.

-----

<a id="further-exploration"></a>
## Further exploration

- [tool-fs](../fs/tool-fs/README.md): the `tool.read`, `tool.write` and `tool.edit` capabilities this dispatcher discovers.
- [agent-core](agent-core/README.md): the caller that lists these tools and injects their host arguments.
- [plugin-kit](../plugin-kit/README.md): `defineTools`, the declaration shape these routes answer.
- [agent package](README.md): the group this dispatcher belongs to.
