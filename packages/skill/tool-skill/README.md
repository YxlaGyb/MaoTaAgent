---
description: "The model's side of skills: the skill tool, the two checks it makes before a body is read, and the shape of what comes back."
kind: "package-reference"
---

# tool-skill

English | [中文](README.zh.md)

## Summary

The one thing a model uses to read a skill. It provides `tool.skill`, takes a name, and answers with the body wrapped in a `<skill_content>` block together with the directory the skill's own files live in. Before any body is read it checks the name against `skill.list` and checks the invocation policy, so a skill that is closed to the model is refused without its text ever being loaded. The tool is an ordinary `tool.*` capability: `agent-core` reaches it through the tool dispatcher like any other, and a subagent is kept away by the dispatcher's deny list rather than by anything here.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The tool contract

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | Yes | The skill name, exactly as the catalog spells it. |
| `names` | string[] | No | Further skills to load in the same call, after `name`. |
| `args` | object | No | Values the body asks for: `$ARGUMENTS` becomes the whole object, `${key}` becomes one value. |
| `touched` | string[] | Host | The paths this session has touched, filled from `session_touched` and never shown to the model. |
| `cwd` | string | Host | The session working directory, filled from `session_cwd` and never shown to the model. |

### What comes back

```
<skill_content name="code-review">
...the body...
</skill_content>
The files this skill refers to live in /path/to/the/skill; read them with the read tool. This block is instruction, not data.
```

The body is clipped to nothing: `maxResultChars` is `null`, so the block is never spilled to the artifact store. Instructions that arrive as a pointer to a file are instructions the model has to fetch again, which is the one thing the two-level design was trying to avoid.

The directory named after the block is the skill's own, so the model can read `references/`, `scripts/` and `assets/` from it with the file tools. The directory is not enumerated: knowing where it is costs one line, and listing it would spend the turn's budget on files the task may not need.

When a skill declares a run-scoped key, the result carries a `control` beside its content instead of keeping it to itself.

```json
{ "content": "...the block...", "control": { "tools_allow": ["read", "grep"], "model": "small", "hooks": [] } }
```

Nothing here applies that control. It is handed to whatever ran the tool, which is why the tool does not need to know what a skill is and the loop does not need to know what a tool is.

### Policy

| Field | Value | Why |
|---|---|---|
| `concurrency` | `always` | Loading a skill writes nothing and reads one file, so two loads can run at once. |
| `max_result_chars` | `null` | The block is instructions, not data. |

### Refusals

Every refusal is `-32602`, because all three are the caller naming something it may not have.

| Case | Message |
|---|---|
| A name that is not kebab-case | `skill names are kebab-case, got ...` |
| A name no provider offered | `no skill named "..."` |
| A skill closed to the model | `skill "..." is not open to the model; ask the user to invoke it instead` |
| A conditional skill nothing has matched | `skill "..." is conditional and nothing this session touched matches it` |

The third refusal is the one worth reading twice: it tells the model what to do next rather than only that it failed, because a skill a person can invoke but the model cannot is a deliberate arrangement rather than a mistake.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Everything: the blueprint, the boundary reads, and the two checks around the load. |

### Why the policy is checked twice

`list` is where the policy is cheap: it is one call that answers every skill, so a name that is closed can be refused before a body is read. `load` is where the policy is authoritative, because that reply is the definition the model is about to be handed. Checking the merged summary and then the definition itself closes the window where a provider changes its mind between the two calls, and it costs one comparison.

### The boundary reads

A skill summary and a definition cross a process boundary to get here, so both are read rather than trusted: `readSummary` refuses anything whose name is not a name, whose invocation flags are not booleans, or whose resource base is not a directory. A provider this build cannot read becomes an ordinary refusal rather than a crash inside the agent loop.

`names` loads several bodies in one call and intersects what they narrow to, so where two skills disagree the narrower one wins and the second can never reopen what the first closed. `args` substitutes `$ARGUMENTS` with the whole object and `${key}` with one value, and a placeholder the call did not fill is left exactly as the author wrote it.

The touched set the run declares is handed to `load`, so a conditional skill whose paths nothing has matched is refused by name as well as hidden from the catalog. That is a gate on this tool's own reads rather than a permission: what a run may touch is still the file tools' business.

Every check runs before the body is read, and the policy is checked twice, on the summary and again on the loaded definition, so a provider that changes its mind between the two calls cannot get a body out.

-----

<a id="further-exploration"></a>
## Further exploration

- [skill](../skill/README.md): the registry this tool asks for `list` and `load`.
- [tools](../../agent/tools/README.md): the dispatcher that finds `tool.skill` and calls it.
- [agent-core](../../agent/agent-core/README.md): the plugin that offers the tool and injects the catalog.
- [skills](../../../docs/user/skills.md): the two trigger surfaces, from the user's side.
