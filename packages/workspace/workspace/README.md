---
description: "Host-owned workspace registrations, session pins and archived membership."
kind: "package-reference"
---

# workspace

English | [中文](README.zh.md)

## Summary

`@maota/workspace` owns the Host-side project list and the two global session sets the sidebar needs: pinned sessions and archived sessions. It exposes revisioned register, rename, remove, pin and archive methods, writes accepted changes atomically to `$MAOTA_HOME/workspaces.json`, and publishes `workspace.changed`. Removing a project deletes only its registration. Its sessions stay on disk, appear as ungrouped, and return to the project when the same path is registered again.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Config

| Key | Type | Default | Meaning |
|---|---|---|---|
| `file` | string | `$MAOTA_HOME/workspaces.json` | The workspace document this plugin reads and writes. |

### Methods

| Method | Parameters | Answer |
|---|---|---|
| `get` | none | `{ revision, projects, pinned_sessions, archived_sessions }`. A missing file reads as `{ revision: 0, projects: [], pinned_sessions: [], archived_sessions: [] }`. |
| `register` | `{ path, name?, expected_revision? }` | The accepted view. A new path appends `{ path, name: name ?? null }`. Registering an existing path is idempotent; when `name` is omitted, its stored name is preserved. |
| `rename` | `{ path, name, expected_revision? }` | The accepted view. `name` must be a string or `null`; an empty trimmed name becomes `null`. An unknown path is `-32602`. |
| `remove` | `{ path, expected_revision? }` | The accepted view. It removes only the registration and is idempotent. Sessions and their files are not touched. |
| `set_pin` | `{ session_id, pinned, expected_revision? }` | The accepted view. `true` moves the id to the front of `pinned_sessions` and removes it from `archived_sessions`; `false` removes the pin. |
| `set_archive` | `{ session_id, archived, expected_revision? }` | The accepted view. `true` removes any pin and adds the id to `archived_sessions`; `false` restores it without restoring a pin. |

All writes accept `expected_revision`. A mismatch is `-32061`. Missing or malformed method parameters are `-32602`, and a malformed stored document is `-32603`.

### Events

| Topic | Payload |
|---|---|
| `workspace.changed` | The complete accepted `{ revision, projects, pinned_sessions, archived_sessions }` view. |

The event is best effort. A client that missed it can call `get` and compare revisions.

### The stored document

| Field | Meaning |
|---|---|
| `schema_version` | `1` for every document this version writes. |
| `revision` | Incremented by every accepted change. |
| `projects` | Registered projects in registration order: `{ path, name }`, where `name` is a string or `null`. |
| `pinned_sessions` | Session ids, most recently pinned first. |
| `archived_sessions` | Archived session ids. Pin and archive membership are mutually exclusive. |

### Path and session semantics

A project path is stored after leading and trailing whitespace is trimmed. No case folding, separator rewriting or symlink resolution is applied, so the exact stored path must match a session's `cwd` for the Web sidebar to put that session in the project group. A session whose `cwd` is not registered is ungrouped. Registering that path again groups the existing sessions without rewriting their documents.

### Declarations

| Field | Value |
|---|---|
| `provides` | `workspace` |
| `injects` | None |
| `registrations` | None |
| `hostCalls` | None |
| `configKeys` | `file` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The capability: project and membership operations, revision checks, events and `selfCheck`. |
| [`src/store.ts`](src/store.ts) | The document model: defaults, readers, atomic writes and revision comparison. |

### Revisioned writes

Every method reads the current document, checks `expected_revision`, applies one pure update and writes a new revision only when the value changed. The write uses a temporary sibling and an atomic rename, with mode `0600`. `workspace.changed` is published only after the rename.

### Membership rules

`pinned_sessions` is an ordered set. Pinning an id that is already pinned changes nothing; pinning an archived id removes it from the archive set in the same write. `archived_sessions` takes precedence over pinning, and restoring an archived id does not restore a previous pin. Removing a project does not inspect the session store because removing a registration cannot create an invalid session reference.

### Reads and failures

A missing document produces the empty revision zero view. An unreadable or malformed document is refused with `-32603` instead of being replaced by defaults. Duplicate project paths and duplicate ids inside the two session arrays are removed while reading, so persisted state cannot produce duplicate rows.

-----

<a id="further-exploration"></a>
## Further exploration

- [session](../../session/README.md): the store that owns the session documents this registry only references by id and working directory.
- [web bridge](../../../apps/web/src/bridge.ts): the RPC surface and sidebar event forwarding.
- [base bundle](../../bundle/base/README.md): the row list that mounts this capability.
