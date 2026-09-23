---
description: "The system-prompt capability: the ordered sections and variables a deployment assembles into one prompt, the two scopes they register into, and the four methods the loop talks to."
kind: "package-reference"
---

# system-prompt/

English | [中文](README.zh.md)

## Summary

The loop owns the conversation but not the words that open it: `agent-core` hands over the facts a turn knows and gets back one string. This plugin holds the registry those facts are rendered into. A section is text with an order and a scope, and it may name variables, which are `{{name}}` holes filled from the facts or from a registered value. The global scope and the turn's own session scope are merged, a session section shadows a global one of the same name, and the result is sorted by order and then by name, so registration order never shows. Four methods cover it: `assemble`, `register`, `unregister` and `release`.

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
| `assemble` | `{ session_id, cwd?, approval?, persona? }` | `{ text, sections, variables }`. `text` is the prompt, `sections` lists what went into it in order, `variables` names the variables that were available, sorted. |
| `register` | `{ name, text, order?, scope?, interpolate? }` | `{ name, order, scope }`. A name already taken in the same scope is a `-32602`. |
| `unregister` | `{ name, scope? }` | `{ removed }`, `false` when the name was not registered in that scope. |
| `release` | `{ scope }` | `{ scope, sections, variables }`, the counts it dropped. Releasing `global` is a `-32602`. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `persona` | the built-in voice | What the deployment says it is. It replaces the `persona` section's text. |

### The built-in sections

| Section | Order | What it states |
|---|---|---|
| `harness` | `-1000` | The one line a deployment is not meant to rewrite, naming the harness and the platform. It is never interpolated. |
| `persona` | `0` | The configured person, or the one this turn was handed. It is never interpolated, so a persona carrying braces comes through as written. |
| `working-directory` | `900` | `working directory: {{cwd}}`, or nothing at all when the turn has none. |
| `approval` | `1000` | One sentence per policy: `ask` says a flagged command waits for the user and a refusal is final, `auto` says it is approved without asking, `full` says commands run without asking. Any other mode says nothing. |

### The registered variables

| Name | Value |
|---|---|
| `session_id` | The turn's session. |
| `cwd` | The turn's working directory, empty when it has none. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/render.ts`](src/render.ts) | `interpolate` and `joinBlocks`. |
| [`src/registry.ts`](src/registry.ts) | `SECTION_ORDERS`, the layer merge, the validators and the `Registry`. |
| [`src/sections.ts`](src/sections.ts) | `DEFAULTS`, `HARNESS`, `approvalText` and `builtins`. |
| [`src/index.ts`](src/index.ts) | The definition: config, the four methods, the seating of the built-ins and the self check. |

### Sections and variables

A section carries text, an order, a scope and whether it is interpolated. Text may be a string or a function of the facts, which is how a built-in says nothing when there is nothing to say: an empty section is dropped instead of leaving a blank paragraph. A variable is a name and either a string or a function of the facts, and a section naming a variable nobody registered stops the assembly with a `-32602` rather than shipping a hole to the model. Both tables are per scope, and a scope is either `global` or a session id.

### Ordering

`assemble` merges the two layers keyed by name, so the session wins a tie, then sorts by order and then by name. The numbers the harness itself uses are spaced, and the section a plugin registers defaults to `0`, which sits between the harness line and the persona. Two sections with the same name in the same scope cannot exist, so the sort is total.

### The facts of one turn

`assemble` takes the facts as arguments rather than reading them, which is what keeps this plugin free of session, filesystem and permission knowledge: the loop already asks for the policy and knows the working directory, and a fact the prompt states and the loop acts on is passed once. `persona` is the exception, because a subagent overrides the deployment's voice for its own run. A fact that is missing is `null` rather than an empty string, so an empty working directory and no working directory are different statements.

### The self check

`selfCheck` covers the parts that are cheap to reach: interpolation with a known, padded, unclosed and empty name, an unknown name throwing, block joining dropping empties, the sort order, the scope and order defaults, a blank persona falling back, a duplicate name and a fractional order being refused, a variable resolving, an unknown variable stopping the assembly, removal, session shadowing and isolation, a released scope, the built-ins assembling in order with no variable left behind, a per-run persona replacing the configured one without being interpolated, and the four methods over the wire.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-core](agent-core/README.md): the caller that assembles a prompt for every turn and hands over the facts.
- [plugin-kit](../plugin-kit/README.md): the definition shape, the channel and `runPlugin`.
- [agent package](README.md): the group this plugin belongs to.
