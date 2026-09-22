---
description: "The todo tool: the task list the model writes for a session, the item shape it accepts, the ceilings it refuses at, and the verification nudge it adds when a list is finished."
kind: "package-reference"
---

# tool-todo

English | [中文](README.zh.md)

## Summary

One capability, `tool.todo_write`, offered to the model as `todo_write`. The model calls it with the whole task list in order, and every call replaces the list before it. The tool keeps no state: it checks the items, refuses a list it cannot trust, writes the list into the session document through the `session` capability, and answers with a count. When the list is long enough and every item is done, that answer also carries a verification nudge. Concurrency is `never`: two writers racing on one plan would make the last write a coin toss.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### `todo_write`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `todos` | array | Yes | The whole task list, in order. Every call replaces the previous list. |
| `session_id` | string | Host | The session this list belongs to. Injected, never published. |
| `cwd` | string | Host | The session working directory. Injected, never published. |

Every item is an object with exactly two fields.

| Field | Type | Meaning |
|---|---|---|
| `content` | string | The step, as the model wants to read it back. Non-blank, and at most `max_content_chars` long. |
| `status` | string | `pending`, `in_progress` or `completed`. |

Result: one line, `plan updated: N tasks, P pending, I in progress, C completed (revision R)`, and, when the nudge applies, one short paragraph after it. The list itself is not echoed back: the model wrote it in the call it just made, and the list is kept in the session for the turns that follow.

Writing an empty list is how a plan is cleared. There is no separate erase, and the revision still moves, so a cleared plan is a written plan like any other.

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_items` | `64` | The most items one call may carry. |
| `max_content_chars` | `400` | The ceiling for one item's content. |
| `verify_nudge` | `true` | Whether the verification nudge is ever added. |
| `verify_min_items` | `3` | The fewest items that can trigger it. |

### The verification nudge

The nudge is added when the list is at least `verify_min_items` long and every item is `completed`, and it asks the model to run the check that proves the result and to say what it ran. Nothing is blocked by it: it rides in the tool result, exactly where the claim of completion was made, and a model that still has verification to do is told to keep those steps in the list as in progress. The trigger tests the statuses only; it never reads the content looking for a word like "test", so it behaves the same in every language.

### Refusals

Every reason a list is refused is collected first, and one answer names all of them. A refused list never reaches the session, so a bad call changes nothing.

| Refusal | When |
|---|---|
| `todos must be an array` | The list is not an array. |
| `todos[i] must be an object` | An item is not an object. |
| `todos[i].content must be a string` | The content is missing or not a string. |
| `todos[i].content must not be blank` | The content is empty or only whitespace. |
| `todos[i].content is N characters, over the max_content_chars of M` | The content is too long. |
| `todos[i].status must be one of pending, in_progress, completed` | The status is missing or unknown. |
| `todos[i].<name> is not part of a todo item` | The item carries a third field. A wider ecosystem has an `activeForm` here; it is named and refused rather than dropped in silence. |
| `todos carries N items, over the max_items of M` | The list is too long. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The declaration, the config, the `session` call and `selfCheck`. |
| [`src/todos.ts`](src/todos.ts) | `checkTodos`, `acknowledgement` and `verificationNudge`. |

### The items are checked here and nowhere else

The parameter language reaches two levels and no further: a tool declares its top level, where `required` and the host sources live, and the nested `items` node can say no more than `{ type: "object" }`. Declaring `additionalProperties: false` on that node would refuse every field, since the node has no `properties` to allow, so the item shape is checked by `run` instead, and a violation comes back to the model as the tool result.

### One call

`run` checks the list, calls `session.save_todos` with the session id, the working directory and the list, and turns the projection that comes back into the one-line acknowledgement. The nudge is appended after the `session` call, never before, so a list the session refused carries no advice. The tool's ceilings are the model-facing ones; the session holds the stricter invariant, `MAX_TODO_ITEMS` and `MAX_TODO_CONTENT_CHARS`, which no caller can raise. The defaults of `max_items` and `max_content_chars` sit below those two on purpose.

### Concurrency

`never` is the honest answer for a whole-list write: two calls for one session that ran side by side would leave the stored plan to whoever finished last. The dispatcher therefore runs this tool alone, and the session's own per-session lock protects the document from the plan write and the message write landing together.

Five facts bound this tool. It writes one whole list at a time: there is no create, update or get per item, and no dependency graph between items. Several items may be in progress at once, which is what parallel work needs, and the description advises one without anything enforcing it. The nudge is advice, so a model that skips verification is not stopped and nothing re-reads the plan later. No event is published for a panel to follow along, so the plan is visible in the session document and in the tool results only. And the plan dies with the session, because there is no plan file and no cross-session list.

-----

<a id="further-exploration"></a>
## Further exploration

- [todo group](../README.md): the group this tool belongs to.
- [session](../../session/README.md): the capability that keeps the plan, and the projection it answers with.
- [tools](../../agent/tools/README.md): the dispatcher that lists this capability and injects the host arguments.
- [Architecture](../../../docs/architecture.md): the component map and the launch path.
