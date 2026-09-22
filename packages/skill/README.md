---
description: "The skill tree: the package that owns the skill dialect and the registry, and the three packages that find skills, ship them, and let the model read one."
kind: "package-group"
---

# skill/: skills

English | [中文](README.zh.md)

## Summary

A skill is instructions a project writes or a deployment ships: one directory with one `SKILL.md`, discovered from a root and read only when a task matches one. This group is the whole chain. [`skill`](skill/README.md) owns the dialect and the registry: the frontmatter rules, the catalog and body renderers, and the `skill` capability that discovers every `skill.*` provider. [`skill-filesystem`](skill-filesystem/README.md) reads the local roots. [`skill-bundled`](skill-bundled/README.md) ships six skills inside its own directory. [`tool-skill`](tool-skill/README.md) is the model's side: the tool that loads one body by name.

## Table of Contents

- [Packages](#packages)
- [How a skill reaches the model](#how-a-skill-reaches-the-model)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Directory | Capability | Role |
|---|---|---|---|
| `@maota/skill` | [`skill`](skill/README.md) | `skill` | The dialect and the registry: the frontmatter projection, the two renderers, the rank rules, and the capability that merges what every provider offers. Imported for its vocabulary and spawned for its capability. |
| `@maota/skill-filesystem` | [`skill-filesystem`](skill-filesystem/README.md) | `skill.filesystem` | The local provider: the project's `.agents/skills`, the configured `dirs`, and `$MAOTA_HOME/skills`. |
| `@maota/skill-bundled` | [`skill-bundled`](skill-bundled/README.md) | `skill.bundled` | The shipped provider: six skills under its own `skills/`, at the lowest rank. |
| `@maota/tool-skill` | [`tool-skill`](tool-skill/README.md) | `tool.skill` | The model's side: the `skill` tool, which loads one body by name and wraps it. |

A provider is any package that provides a `skill.*` capability, so the registry is not tied to these two: a deployment that reads skills from somewhere else adds a package and nothing changes here. `skill-filesystem` and `skill-bundled` are the two a default profile mounts.

<a id="how-a-skill-reaches-the-model"></a>
## How a skill reaches the model

The catalog and the body are two levels, and the split is a cost decision: the catalog is one line per skill and rides in the conversation until it changes, while a body is read only when the model asks for it, so a skill costs its full text only when it is used.

| Step | Who | What happens |
|---|---|---|
| 1 | a provider | Scans its roots and offers candidates: name, description, the recognised frontmatter, a rank and an opaque locator. |
| 2 | `skill` | Merges by rank and then by provider name, drops what it cannot read, and answers `list` and `catalog`. |
| 3 | `agent-core` | Asks for `catalog`, compares it with the newest catalog in the history, and appends a note when it changed, so a turn spends no new tokens until something moved. |
| 4 | the model | Calls the `skill` tool with an exact name. |
| 5 | `tool-skill` | Checks the name and the policy against `list`, then asks `skill` for `load` and returns the body wrapped. |

`paths` is the one conditional field: a skill that declares patterns stays out of the catalog until the session has touched a matching path, and the touched paths are read back from the stored history, so the condition survives a restart.

<a id="related-documentation"></a>
## Related documentation

- [skills](../../docs/user/skills.md): the two levels, the frontmatter contract and the two trigger surfaces.
- [packages/](../README.md): the plugin tree this group belongs to.
- [agent-core](../agent/agent-core/README.md): the plugin that injects the catalog and offers the tool.
- [Architecture](../../docs/architecture.md): the component map and the launch path.
