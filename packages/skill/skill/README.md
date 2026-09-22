---
description: "The skill dialect and the registry: the frontmatter projection, the catalog and body renderers, the rank rules, and the skill capability that merges what every skill.* provider offers."
kind: "package-reference"
---

# skill

English | [中文](README.zh.md)

## Summary

One package holds two things, because they are the same vocabulary: the dialect every provider and consumer speaks, and the registry that merges what the providers offer. The dialect is the frontmatter projection, the `SkillSummary` and `SkillCandidate` shapes, the catalog renderer and the body renderer. The registry provides `skill` with `list`, `load` and `catalog`, discovers every `skill.*` capability the kernel published, and settles a duplicate name by rank and then by provider name. Providers import this package for its vocabulary while the profile spawns it for its capability, so it serves only in a process that was started with it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The capability

| Method | Parameters | Answer |
|---|---|---|
| `list` | `{ cwd?, touched? }` | `{ complete, skills }`: one summary per skill, sorted by name. `complete` is false once any provider or candidate could not be read. |
| `load` | `{ name, cwd?, touched? }` | `{ skill }`: the summary plus `content`. An unknown name is refused with `-32602`, and so is a name that is switched off or whose `paths` match nothing touched. |
| `catalog` | `{ cwd?, touched? }` | `{ complete, entries, text }`: the entries the model may invoke, and the rendered block. |
| `conflicts` | `{ cwd? }` | `{ conflicts, disabled, total }`: every name two providers both publish, with the winner and the ones it hid. |
| `disable` / `enable` | `{ name, cwd? }` | `{ disabled }`: the names this deployment is not showing. An unknown name is refused with `-32602`. |

`cwd` is the session's working directory and decides which project root the providers scan. `touched` is the list of paths the session has already touched, and it is what activates a conditional skill. `catalog_description_max` (default 500) and `catalog_max_chars` (default 8000) are the two config keys, both budgets for the rendered block.

### What crosses the boundary

| Type | Fields |
|---|---|
| `SkillSummary` | `name`, `description`, `whenToUse?`, `source`, `provider`, `invocation`, `paths?`, `active`, `resourceBase?`, `allowedTools?`, `model?`, `hooks?`, `context?` |
| `SkillDefinition` | `SkillSummary` plus `content` |
| `SkillCandidate` | `SkillSummary` without `provider` and `active`, plus `rank` and `locator` |
| `SkillControl` | `tools_allow?`, `model?`, `hooks?`, `context?`: the run-scoped half, which a tool result carries to the loop. |

`provider` is the capability name that served the skill, so a consumer can say where it came from. `active` is true for a skill with no `paths`, and for one whose patterns match a touched path. `resourceBase` is the directory the skill's own files live in, which is what the model is told to read `references/`, `scripts/` and `assets/` from. The last four fields are the run-scoped half of a skill, and `readControl` is the reader that turns them into what a tool result hands the loop.

### The frontmatter contract

A provider parses frontmatter into an open record and hands it here, and `projectSkill` decides what it means. The rules are about what a bad value costs.

| Key | Rule | Cost of a bad value |
|---|---|---|
| `name` | Kebab-case, and equal to the directory or file name. Falls back to the entry name when absent. | The entry is dropped, with a warning. |
| `description` | The one line the model always sees. Falls back to the first non-heading paragraph of the body. | The entry is dropped when there is no paragraph either. |
| `when-to-use` | A non-empty string. Shown to a person, never to the model. | Left out, with a warning. |
| `paths` | A list of path patterns. | Left out, with a warning. |
| `user-invocable` | A boolean, written `true/false`, `yes/no`, `on/off` or `1/0`. | The entry is dropped, with a warning. |
| `disable-model-invocation` | The same boolean spelling, inverted into `modelInvocable`. | The entry is dropped, with a warning. |
| `allowed-tools` | A list of tool names. Narrows the run for as long as it lasts. | The entry is dropped, with a warning. |
| `model` | A non-empty model name. Runs the rest of the run against it. | Left out, with a warning. |
| `hooks` | A list of `{ event, command, matcher?, timeout_ms? }`, inline or as a block. | Left out, with a warning. |
| `context` | `inline` (the default) or `fork`. | Left out, with a warning. |

Every key this build reads is enforced, and a key it does not read is dropped rather than kept as metadata. The cost of a bad value follows what the key controls. A malformed `user-invocable`, `disable-model-invocation` or `allowed-tools` drops the skill, because reading a broken control as "unset" would advertise a skill its author closed or hand back the wider tool surface it was written to narrow. A malformed `when-to-use`, `paths`, `model`, `hooks` or `context` only loses that field, because none of them decides whether the skill exists. Both spellings of a key read the same key, so a document written as `allowed_tools` or `when_to_use` is not silently ignored.

### The provider contract

A provider is a plugin that provides a `skill.<name>` capability, where the name matches the capability grammar the kernel checks.

| Method | Parameters | Answer |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`. |
| `load` | `{ locator }` | `{ content }`: the body with the frontmatter removed. |

`locator` is whatever the provider put on the candidate and is opaque to this package. A provider that cannot answer throws, or answers something this build cannot read, and that costs the provider its turn rather than the whole read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | The dialect: `isSkillName`, the entry and summary types, `summarize`, `projectSkill`, `parseFrontmatter`, `renderCatalog` and `renderSkillContent`. |
| [`src/scan.ts`](src/scan.ts) | `scanSkillRoot`: one directory read as a bundle (`<name>/SKILL.md`) or a flat entry (`<name>.md`). |
| [`src/index.ts`](src/index.ts) | The registry: discovery, `collect`, the three methods and `selfCheck`. |

### Discovery, merging and failure

`start` reads the capability table once and keeps every name that begins with `skill.`, the way the tool dispatcher keeps every `tool.` name. `list` then asks each provider in turn and sorts the candidates by rank, then by provider capability name, then by the order the provider listed them, so the winner of a duplicate name never depends on the order a table happened to be built in. Two providers, the same rank and the same capability name is a configuration mistake rather than a rule this package should invent.

A provider that throws, or answers something this build cannot read, is reported once with a warning and leaves `complete` false. Every other provider's candidates still come back, because one broken provider should cost its own skills rather than the whole catalog.

### The two renderers

`renderCatalog` writes an `<available_skills>` block with one `<skill name="...">` line per entry, clipping a long description to `catalog_description_max` and stopping at `catalog_max_chars` with an `<omitted count="n"/>` line when the budget runs out, plus a closing line telling the model to call the tool by an exact name. `catalog` is the only place those two budgets apply.

`renderSkillContent` wraps a loaded body in `<skill_content name="...">`, then names the skill's directory and says the block is instruction rather than data. That sentence is the reason the block is wrapped at all: a body is text a stranger wrote, and the model is told how to read it.

### Imported and spawned

This package is the one that both is a plugin and is imported: the three sibling packages import it for the dialect while the profile spawns it for the `skill` capability. `runPlugin` runs at module scope, so an import would open a second server on the same stdin and one plugin would answer twice; the entry therefore calls `isPluginEntry(import.meta.url)` first and serves only when the process was started with it. The same guard would be needed by any package that grows a sibling that imports it.

-----

<a id="further-exploration"></a>
## Further exploration

- [skill-filesystem](../skill-filesystem/README.md): the provider that reads the local roots.
- [skill-bundled](../skill-bundled/README.md): the provider that ships six skills.
- [tool-skill](../tool-skill/README.md): the tool the model loads a body through.
- [skills](../../../docs/user/skills.md): the two levels and the frontmatter contract, from the user's side.
- [plugin-kit](../../plugin-kit/README.md): `isPluginEntry`, the tool schemas and the glob matcher this package reuses.
