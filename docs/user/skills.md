# Skills

English | [中文](skills.zh.md)

A skill is a folder with a `SKILL.md` in it: instructions a model reads only when a task calls for them. This document owns the arrangement from the outside: where a skill lives, which frontmatter keys take effect and what a bad value costs, how a skill reaches the model and how it reaches a person, and what changes when a run loads one.

## Table of Contents

- [Two levels](#two-levels)
- [Where a skill lives](#where-a-skill-lives)
- [The frontmatter contract](#the-frontmatter-contract)
- [Loading a skill](#loading-a-skill)
- [What a loaded skill changes about the run](#what-a-loaded-skill-changes-about-the-run)
- [For people](#for-people)
- [Related documentation](#related-documentation)

-----

<a id="two-levels"></a>
## Two levels

A skill is read in two steps, and the split is the whole design.

The catalog is cheap and always there: one line per skill, name and description, sent once and then left in the conversation. Its budget is `catalog_max_chars` (default 8000) with each description clipped to `catalog_description_max` (default 500), and a turn that would send the same lines sends nothing.

The body is expensive and read on demand: it arrives only when a task matches, and it arrives as instructions rather than as a pointer to a file, because an instruction that has to be fetched again is an instruction the model may never read.

That is why the description is the most important line you write. It is the trigger, not a summary: describe the task that should summon the skill, in the words a person would use to ask for it.

<a id="where-a-skill-lives"></a>
## Where a skill lives

Roots are scanned by rank, and a lower rank wins a duplicate name.

| Rank | Root | Source shown to a person |
|---|---|---|
| 100 | `<project root>/.agents/skills` | `project` |
| 300 | each directory in the `skill-filesystem` `dirs` config | `custom` |
| 400 | `$MAOTA_HOME/skills` (default `~/.maota/skills`) | `user` |
| 600 | the six shipped inside `@maota/skill-bundled` | `bundled` |

The project root is the nearest ancestor holding `.git`, so a session opened in a subdirectory still finds what the repository publishes. Two shapes are read: a folder `<name>/SKILL.md`, and a flat file `<name>.md`. A folder may sit up to three levels below the root, so a grouping folder works. A skill's own `references/`, `scripts/` and `assets/` are never skills of their own.

A root is watched, so a skill added or edited while a session is open is listed on the next read. Nothing is copied anywhere: the folder is read where it is.

<a id="the-frontmatter-contract"></a>
## The frontmatter contract

| Key | Effect | Cost of a bad value |
|---|---|---|
| `name` | Kebab-case, and equal to the folder or file name. Falls back to the entry name. | The skill is dropped. |
| `description` | The catalog line, and the trigger. Falls back to the first paragraph of the body. | The skill is dropped when there is no paragraph either. |
| `when-to-use` | Shown to a person, never to the model. | The key is left out. |
| `paths` | The skill stays hidden until a touched path matches one of these patterns. | The key is left out. |
| `user-invocable` | `false` keeps it out of the menu in the web input box. | The skill is dropped. |
| `disable-model-invocation` | `true` keeps it out of the catalog and refuses the tool. | The skill is dropped. |
| `allowed-tools` | Narrows the run to these tools for as long as the run lasts. | The skill is dropped. |
| `model` | Runs the rest of the run against this model. | The key is left out. |
| `hooks` | Command hooks registered for the run and withdrawn when it ends. | The key is left out. |
| `context` | `fork` runs the body on its own and returns only its last text. | The key is left out. |

Booleans may be written `true/false`, `yes/no`, `on/off` or `1/0`. Both spellings of a key read the same key, so `allowed_tools` and `when_to_use` work too. A key this build does not read is dropped rather than kept.

The three keys that can drop a skill are the ones that decide what a run is allowed to do. Reading a broken `user-invocable`, `disable-model-invocation` or `allowed-tools` as "unset" would advertise a skill its author closed, or hand back the wider tool surface it was written to narrow. The rest only lose themselves.

`paths` is a list of glob patterns, matched against the files the session has already touched. It is a trigger rather than a permission: it decides when a skill is offered, not what it may read.

<a id="loading-a-skill"></a>
## Loading a skill

The model calls the `skill` tool with an exact name from the catalog. Before your body is read, the tool checks that the name is real, that the skill is open to the model, and that a conditional skill has actually matched something this session touched. A refusal costs one call and reads no file.

The answer is the body wrapped in a `<skill_content>` block, followed by one line naming the folder the skill lives in. That line is the point of `references/`, `scripts/` and `assets/`: the model reads them with the ordinary file tools, only when the task needs them.

A body may ask for values with `$ARGUMENTS` (the whole argument object) and `${key}` (one value from it). A placeholder the call did not fill is left exactly as you wrote it.

<a id="what-a-loaded-skill-changes-about-the-run"></a>
## What a loaded skill changes about the run

Four keys are about the run rather than about the text.

`allowed-tools` narrows the tool surface. It only ever narrows: two skills loaded in one run intersect, so the second cannot reopen what the first closed, and nothing can widen what the deployment allowed. The narrowing lasts until the run ends.

`model` switches the model for the rest of the run.

`hooks` registers command hooks for the run. Each is a child process handed the event on stdin as JSON, and each run of one is appended to `$MAOTA_HOME/audit/hooks.jsonl`. They are withdrawn when the run ends, so a skill does not leave anything behind.

`context: fork` runs the body as its own run and returns only that run's last words. The instructions and the tool traffic stay in the child; the call that asked gets a result. A forked body may not reach the skill tool again, so a skill cannot recurse through itself.

<a id="for-people"></a>
## For people

A skill that is `user-invocable` and open to the model appears in a menu in the web input box. Choosing it inserts `Use the "<name>" skill.` into the message rather than expanding the body, so the instruction you send is the one you can still edit, and the model decides when to read it.

The sidebar has a read-only page listing every skill: its name, description, when-to-use line, source, the provider that served it, whether it is conditional, and the keys it declares about the run. It does not preview the body.

`disable` switches a skill off for the deployment, and `conflicts` reports any name two providers both publish, with the winner and the rows it hid.

<a id="related-documentation"></a>
## Related documentation

- [Hooks](hooks.md): the events and the hook dialect a skill hook is written against.
- [Subagents](subagent.md): why a subagent is given no skill tool by default.
- [Packages](../packages.md): where the skill packages sit.
