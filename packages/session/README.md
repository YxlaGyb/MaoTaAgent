---
description: "Stored conversations: the document one session keeps per working directory, its messages, its title, and the plan the model writes into it."
kind: "package-reference"
---

# session

English | [中文](README.zh.md)

## Summary

Stored conversations: one JSON document per session and working directory, holding the messages of a turn, the title a session is listed under, and the plan the model keeps. Seven methods answer a caller: `list`, `load`, `save`, `delete`, `children`, and the plan pair `todos` and `save_todos`. The document is version 3, written whole to a temporary file and renamed into place under a per-session lock. Saving the messages never drops the plan, and a document written by version 1 or 2 is normalized on the way in and written back as version 3. A document may carry a parent link, which is how a subagent's session is stored: it stays in its parent's folder, out of `list`, and is reachable through `children`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Methods

| Method | Parameters | Returns |
|---|---|---|
| `list` | none | `{ dir, sessions }`, sorted by `updated_at`, newest first. A document that carries a parent is left out. |
| `load` | `{ id, cwd }` | The document, with `dangling` worked out. A session that has never been written reads as an empty one. |
| `save` | `{ id, cwd, title?, messages, parent? }` | The document as written. |
| `delete` | `{ id, cwd }` | `{ deleted }`. |
| `children` | `{ id, cwd }` | `{ children }`: the subagent sessions this one spawned, oldest first, each a summary of the shape `list` uses. |
| `todos` | `{ id, cwd }` | The plan projection. |
| `save_todos` | `{ id, cwd, todos }` | The plan projection after the write. |

### The document

| Field | Meaning |
|---|---|
| `schema_version` | `3`, for every document this version writes. |
| `id` | The session id. |
| `cwd` | The working directory this session belongs to, trimmed of trailing separators. |
| `title` | What `list` shows. A `save` that omits it keeps the title already stored. |
| `created_at` | When the document was first written. |
| `updated_at` | When it was last written, by either write path. |
| `messages` | The transcript: the same array `agent-core` assembles and hands back. |
| `events` | Append-only, one entry per plan write: `{ kind: "todos.write", at, todos }`. A document this version writes always carries the field, empty at first. |
| `parent` | `null` for a session a person opened, or the link to the session that spawned this one: `{ id, cwd, call_id, type, description }`. |
| `dangling` | Not stored: `load` sets it when the last message is a user message, which is what a turn that never finished looks like. |

### The parent link

A child's document sits in the parent's own folder, because a subagent is handed the parent's working directory and never writes outside it, and its `parent` records which session spawned it, in which directory, under which call, and the label that call carried. Three answers follow from it: `list` leaves linked documents out, so a sidebar and a search never see a subagent; `children` returns the ones a session started, oldest first; and every summary carries the link, so a page that reopens an old session can rebuild the entry under the right call without loading anything.

A parent handed to `save` must name a session id, and anything else is refused. A malformed link inside a file reads as no link at all: a stored document is read leniently, while a value this process was handed is a bug worth refusing.

### The plan

`save_todos` appends one event carrying the whole list, and the projection is folded from those events.

| Field | Meaning |
|---|---|
| `revision` | The number of write events. A session that never wrote a plan reads `0`. |
| `updated_at` | The time of the last event, or `null` when there is none. |
| `todos` | The last snapshot, in the order the model wrote it. |
| `counts` | `pending`, `in_progress` and `completed`, counted over that snapshot. |

Writing an empty list clears the plan and still moves the revision, so a caller that watches the revision sees every write, including the one that emptied the list.

### Config

| Key | Default | Meaning |
|---|---|---|
| `dir` | `$MAOTA_HOME/sessions` | Where the documents live, one directory per working directory. |
| `max_bytes` | `52428800` | The ceiling for one document, checked before it is written. |
| `max_path` | `250` (`4000` outside Windows) | The longest path a document may resolve to. |

### Refusals

| Refusal | When |
|---|---|
| `session id must match ...` | The id is empty, too long, or carries a character outside the id shape. |
| `session <id> already belongs to ...` | Another working directory encodes to the same folder. |
| `session path is N chars, over the max_path limit of M` | The document would land on a path too long for the platform. |
| `session <id> is over the N byte cap` | The document, plan included, would pass `max_bytes`. |
| `todos must be an array` | A plan write carried something else. |
| `invalid todos: ...` | An item is not an object, its content is blank or over 2000 characters, its status is not one of the three, or it carries a field beyond `content` and `status`. Every reason is listed in one message. |
| `parent must name the session that spawned this one, got ...` | The link handed to `save` is not an object with a usable session id in it. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The capability: config, the seven methods, and `selfCheck`. |
| [`src/store.ts`](src/store.ts) | The document layer: paths, reading, the atomic write, the plan read and append, and the child lookup. |
| [`src/plan.ts`](src/plan.ts) | The plan itself: item shapes, the ceilings, the projection and the event filter. |

### One writer at a time

Both write paths go through `serially`, keyed by the working directory and the session id, so a plan write and a message write for one session can never interleave: each reads the document, changes the part it owns and writes the whole file back. The write itself is a temporary file in the session directory followed by a rename, with mode `0o600`, so a reader sees either the document before the write or the one after it, never half of one. The same lock is what keeps `save` from dropping a plan that was appended between its read and its write.

### What each write path owns

`save` owns `messages`, `title` and `updated_at`, and preserves `events` from the document it read. `save_todos` owns `events` and `updated_at`, and preserves everything else, messages included. Neither path rewrites the other's field, which is why the plan survives a turn and the transcript survives a plan write.

### Versions

`load` accepts a document whose `schema_version` is 1 or 2, filling in an empty `events` and no parent, and a document with no version field at all the same way. Anything else is read as an unreadable file, which is also what a corrupt document gets. The first `save` after such a read writes the document back at version 3, so the migration costs one write and needs no separate command. An event, or a parent link, whose shape this version cannot trust is dropped while the rest of the document is kept.

### A child is found, never listed

`childrenOf` walks the parent's own directory and keeps the documents whose `parent.id` is the session asked about, sorted by creation and then by id, so the answer is stable when two children are written inside the same millisecond. Nothing indexes it, and a document whose link was lost becomes an ordinary session of its own, which is the honest outcome of a link that is only as good as the file it was written to.

### The ceilings

`MAX_TODO_ITEMS` and `MAX_TODO_CONTENT_CHARS` in `src/plan.ts` are the invariant: no caller of `save_todos` can grow a document without bound, and the tool that faces the model keeps its own smaller, configurable limits. The document's own `max_bytes` stays the backstop for everything, plan and transcript together.

-----

<a id="further-exploration"></a>
## Further exploration

- [agent-core](../agent/agent-core/README.md): the caller that saves the transcript of every turn.
- [tool-todo](../todo/tool-todo/README.md): the tool that writes plans through `save_todos`.
- [packages/, the plugin tree](../README.md): which plugin owns which capability.
- [Architecture](../../docs/architecture.md): the component map and the launch path.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The lock is in-process**: two hosts pointed at one `$MAOTA_HOME` can still write one session, and the last rename wins.
- **The events grow**: every plan write appends a snapshot, and nothing prunes them, so `max_bytes` is what eventually says stop.
- **`list` reads every document**: there is no index, and a large `sessions` tree is walked in full on every `list`.
- **A child is invisible to `list`**: the only way to reach one is `children` of its parent, so a subagent whose parent document is gone is a session nobody lists.
- **An unreadable document reads as a fresh session**: a corrupt file, or one from a newer schema version, comes back empty, and the next `save` would write over it.
- **No plan history**: the projection is the last snapshot, and the events are not exposed as a list of their own.
