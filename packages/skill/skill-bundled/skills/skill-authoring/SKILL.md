---
name: skill-authoring
description: MaoTa project only: write or change a skill in the MaoTa repository, where a SKILL.md lives, which frontmatter keys take effect in this build, and what belongs in references and scripts.
when-to-use: When the working directory is a MaoTa checkout and the user asks for a new skill, or asks why a skill is not being listed or loaded.
---

# Authoring a skill (MaoTa)

This skill is about the MaoTa repository and its own skill layout. It does not
describe a general or portable skill format, and it does not apply to other
projects that use a skills directory of their own.

In MaoTa a skill is one directory with one `SKILL.md` under a skills root.
Nothing else is required, and nothing else is discovered.

## Where the file goes

Roots are scanned by rank, and a lower rank wins a duplicate name:

| Rank | Root | Source |
|---|---|---|
| 100 | `<project root>/.agents/skills` | `project` |
| 300 | each directory in the `skill-filesystem` `dirs` config | `custom` |
| 400 | `$MAOTA_HOME/skills` (default `~/.maota/skills`) | `user` |
| 600 | the skills shipped inside `@maota/skill-bundled` | `bundled` |

The project root is the nearest ancestor holding `.git`. Two entry shapes are
read: a bundle `<name>/SKILL.md` and a flat `<name>.md`. A bundle may sit up to
three levels below the root, so a grouping folder such as `skills/ui/table/`
works; a `SKILL.md` deeper than that is not a skill. A root is watched, so a
skill added or edited while a session is open is listed on the next read.

## The frontmatter contract

`name` must be kebab-case and must equal the directory or file name. When it is
missing the entry name is used; when it disagrees the skill is dropped and a
warning is logged.

`description` is the one line the model always sees, so write it as a trigger:
what the task looks like, not what the skill contains. It falls back to the first
paragraph of the body.

These keys are read by this build:

| Key | Effect |
|---|---|
| `description` | the catalog line |
| `when-to-use` | shown to a person in the web skill page |
| `paths` | the skill stays hidden until a touched path matches one of these globs |
| `user-invocable` | `false` keeps it out of the web trigger menu |
| `disable-model-invocation` | `true` keeps it out of the catalog and refuses the `skill` tool |
| `allowed-tools` | narrows the run to these tools for as long as the run lasts |
| `model` | runs the rest of the run against this model |
| `hooks` | command hooks registered for the run and withdrawn when it ends |
| `context` | `fork` runs the body on its own and returns only its last text |

The underscore spelling of each key reads the same as the hyphenated one, so a
document written as `allowed_tools` or `when_to_use` is not silently ignored. A
key this build does not read is dropped; nothing is kept as metadata.

A bad boolean on `user-invocable` or `disable-model-invocation` drops the whole
skill, and so does a bad `allowed-tools`, because reading a broken control as
"unset" would advertise a skill its author closed or hand back the wider tool
surface it was written to narrow. A bad `model`, `context`, `hooks` or `paths`
only loses that key: none of them decides whether the skill exists.

`allowed-tools` only ever narrows. Two skills loaded in one run intersect, so the
second cannot reopen what the first closed, and neither can widen what the
deployment allowed.

`hooks` is a list, written either inline or as a block:

```yaml
hooks:
  - event: PreToolUse
    command: ./guard.ps1
    matcher: pwsh
    timeout_ms: 5000
```

`event` is one of the events the hook engine publishes, `command` runs as a child
process with the event on stdin as JSON, `matcher` filters on the tool name for
the two tool events, and each run is appended to `$MAOTA_HOME/audit/hooks.jsonl`.

## references, scripts and assets

Put long material beside the `SKILL.md` and point at it by relative path. The
loaded result tells the model which directory the skill lives in, and the model
reads those files with the file tools only when it needs them. Loading a skill
does not read them.

## Checking your work

Start a session in the repository and confirm the catalog line appears once. Then
run the tool by hand, or ask for the task the description claims to trigger.
`paths` only takes effect on the turn after the matching file is touched.
