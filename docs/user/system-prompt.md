# The system prompt

English | [中文](system-prompt.zh.md)

Every turn opens with one message the model reads before the conversation: who it is, where it is working, and what it may do without asking. The loop does not write that message. A plugin owns it, the loop hands over the facts the turn knows, and the two cannot drift apart because the prompt states exactly what the loop acts on. This document owns that prompt: its sections, its variables, its scopes, and how a deployment changes what it says.

## Table of Contents

- [Where the prompt comes from](#where-the-prompt-comes-from)
- [The sections that always ship](#the-sections-that-always-ship)
- [Changing the persona](#changing-the-persona)
- [Registering a section](#registering-a-section)
- [Variables and the facts of a turn](#variables-and-the-facts-of-a-turn)
- [The two scopes](#the-two-scopes)
- [What this does not cover](#what-this-does-not-cover)
- [Related documentation](#related-documentation)

-----

<a id="where-the-prompt-comes-from"></a>
## Where the prompt comes from

The `system-prompt` plugin provides one capability of that name and four methods. `agent-core` calls `assemble` once per turn, with the session id, the working directory, the approval mode it just read, and the persona a subagent was started with. What comes back is one string, plus the list of sections that went into it.

Nothing else in the harness builds prompt text. A plugin that wants to say something to the model registers a section instead of concatenating strings into a message of its own, and the loop sends whatever the assembly returned.

<a id="the-sections-that-always-ship"></a>
## The sections that always ship

| Section | Order | What it says |
|---|---|---|
| `harness` | `-1000` | One line naming the harness and the platform. |
| `persona` | `0` | How the deployment wants the model to work and answer. |
| `working-directory` | `900` | The directory the turn is working in. |
| `approval` | `1000` | What the current approval mode means for a flagged command. |

An empty section is dropped rather than left as a blank paragraph, which is why a deployment with no working directory and no permission layer reads one paragraph shorter instead of reading two paragraphs of nothing.

<a id="changing-the-persona"></a>
## Changing the persona

The `persona` section is the one a deployment normally changes. It has a config key of its own, so a profile states its voice in the machine layer rather than editing code:

```toml
[plugins.system-prompt.config]
persona = "Answer in short paragraphs and name the file you changed."
```

The persona is never interpolated, so braces in it come through as written. A subagent that was started with a system prompt of its own replaces the persona for its run only, and every other section stays: the subagent still learns where it is and what it may do.

<a id="registering-a-section"></a>
## Registering a section

A plugin that has something to add calls `register` with a name, the text, and optionally an order, a scope and whether the text is interpolated. The text may also be a function of the turn's facts, which is how a section says something different in one session than in another, or says nothing at all.

A name already taken in the same scope is refused, so two plugins cannot quietly overwrite each other. `unregister` removes a section by name, and `release` drops everything a scope registered at once, which is what a session does when it ends. The global scope cannot be released.

<a id="variables-and-the-facts-of-a-turn"></a>
## Variables and the facts of a turn

A section can name a variable, written `{{name}}`, and the assembly fills it in. The prompt ships two: `session_id` and `cwd`. A plugin can register more, with a fixed value or a function of the facts.

A section that names a variable nobody registered stops the assembly and the turn fails, rather than sending the model a hole where a fact should be. That is deliberate: a prompt with `{{cwd}}` in it is a bug the model will try to read around.

A fact that is missing is not an empty string. An empty working directory and no working directory are different statements, and only the second one leaves the sentence out.

<a id="the-two-scopes"></a>
## The two scopes

A section belongs either to `global` or to one session. The assembly merges both, and a session section shadows a global one with the same name, so a plugin can register a rule everywhere and a session can replace that one rule for itself. Releasing a session scope takes its sections and variables with it and leaves the global ones alone.

Within a scope the sections are sorted by order and then by name. Registration order never shows in the result, so two plugins that both want the last word have to say so with a number rather than with luck.

<a id="what-this-does-not-cover"></a>
## What this does not cover

- The prompt is a single message at the start of the conversation. Context that arrives mid-turn, such as the skill catalogue, travels as a message of its own and is not part of this assembly.
- Tool schemas are not part of the assembly either: they are passed to the model beside the prompt, by the tools capability.
- Prompt caching is not arranged here. The same facts produce the same string, which is what a cache would need, but no boundary is marked for a provider.

<a id="related-documentation"></a>
## Related documentation

- [the permission gate](permission.md): the plugin that answers the approval mode this prompt states.
- [the subagents](subagent.md): the runs that replace the persona and keep every other section.
- [Architecture](../architecture.md): the component map and the launch path.
- [the system-prompt package](../../packages/agent/system-prompt/README.md): the methods, the config keys and the source map.
