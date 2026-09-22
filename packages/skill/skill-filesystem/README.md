---
description: "The local skill provider: the three roots it scans, the ranks that settle a duplicate name, the two entry shapes, how deep a bundle may sit, and its config keys."
kind: "package-reference"
---

# skill-filesystem

English | [中文](README.zh.md)

## Summary

Where a project's own skills come from. It scans three roots and offers everything it finds as candidates: the project's `.agents/skills`, the directories the profile configured, and `$MAOTA_HOME/skills`. Each root carries the rank that settles a duplicate name, the project first and the person's own directory last. Frontmatter is parsed into an open record and handed to `projectSkill` for the projection, so the rules about names and booleans live in one place and this package only reports what came back. It knows nothing about catalogs, budgets or the model.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The roots

| Rank | Root | `source` |
|---|---|---|
| 100 | `<project root>/.agents/skills` | `project` |
| 300 | every directory in the `dirs` config | `custom` |
| 400 | `$MAOTA_HOME/skills`, defaulting to `~/.maota/skills` | `user` |

The project root is the nearest ancestor holding `.git`, so a session opened in a subdirectory still finds the skills its repository publishes. With no `.git` anywhere above it, the project root is the session's own directory. A relative `dirs` entry is resolved against that directory rather than against the plugin's own.

The rank is what the registry uses to settle a duplicate name, and it is also why a project can replace a skill the deployment ships without editing the shipped one.

### The two entry shapes

| Shape | Read as | `resourceBase` |
|---|---|---|
| `<name>/SKILL.md` | a bundle | that directory |
| `<name>.md` | a flat entry | the root itself |

A bundle may sit up to `max_depth` levels below its root, so a grouping folder such as `skills/ui/table/` is read while the `references/` and `scripts/` a skill carries never become skills of their own, and a directory without a `SKILL.md` is not a skill. A file or directory whose name begins with `.` is skipped. A skill still calls itself what its own folder is called, whatever nesting it sits at.

### Configuration

| Key | Meaning |
|---|---|
| `dirs` | Extra roots at rank 300, in the order given. A non-string entry is ignored. |
| `max_depth` | How many levels below a root a bundle may sit. Default 3, and a value that is not a positive integer falls back to it. |

### The two methods

| Method | Parameters | Answer |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`, one per entry found, in root rank order. |
| `load` | `{ locator }` | `{ content }`: the body with the frontmatter removed. A locator without a path is refused with `-32602`. |

The `locator` is `{ path }`, and it is handed out by `list` rather than accepted from a caller, so a load cannot name a file no root offered.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Everything: the root list, the project-root walk, `list`, `load` and `selfCheck`. |
| `@maota/skill` | `scanSkillRoot` walks one directory, and `projectSkill` decides what the frontmatter means. |

### Where a rule lives

The rules that decide whether a skill survives are in [`@maota/skill`](../skill/README.md), because the shipped provider obeys the same ones: kebab-case names, a name that has to equal its entry, and the fail-closed booleans. What this package adds is the geography: which directories are roots, in what order, and what a root means for `resourceBase`. A root that does not exist is not an error, which is what makes `.agents/skills` optional in a project.

### Why a body has no size limit here

The budget that matters is the catalog's, and it belongs to the registry, because the catalog is what rides in the conversation. A body is read once, on purpose, by a model that asked for it by name; capping it here would truncate instructions rather than save a recurring cost. An earlier version of this package had a `max_bytes` key and it was removed with that reasoning.

### Warnings

Everything a scan does not like becomes a line through `ctx.channel.log("warn", ...)`: a file that cannot be read, a name that does not match its entry, a boolean that is not a boolean, a `paths` that is not a list. The warn channel is the only place a person finds out why one skill did not appear, so the message names the file.

Two facts shape this provider. It reads local files synchronously, so a skill that lives behind a service needs a provider of its own rather than another key here; and `MAOTA_HOME` is consulted when a root list is built rather than once at startup, which is deliberate for tests and harmless in a deployment.

Correctness never depends on the watcher. Every call compares a cheap signature of the root and the cache is dropped when a `fs.watch` event arrives, so watching only makes a scan cheaper and never makes a stale one correct.

-----

<a id="further-exploration"></a>
## Further exploration

- [skill](../skill/README.md): the dialect and the registry, including the frontmatter projection.
- [skill-bundled](../skill-bundled/README.md): the provider that ships the skills this one is usually mounted beside.
- [skills](../../../docs/user/skills.md): where a person puts a skill and which keys take effect.
