---
description: "The permission plugin: the per-session mode, the questions waiting for an answer, the four outcome words, and the audit file that pairs every ask with its decision."
kind: "package-reference"
---

# permission

English | [中文](README.zh.md)

## Summary

One capability, `permission`, that a tool calls before it does something the user should decide about. It holds a mode per session and working directory, parks a question until somebody answers it, and answers with one of four words of which only `allowed-once` is a grant. Every asked question is paired with its decision in an audit file that survives a restart, and the mode itself is audited when it changes. Registrations are per plugin, so a front end that restarts replaces its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Config

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mode` | string | `ask` | The mode a session falls back to before it chooses one of its own. One of `ask`, `auto`, `full`. |
| `dir` | string | `$MAOTA_HOME/permissions` | Where the audit files live. One directory per working directory, one file per session. |
| `max_records` | integer | `500` | How many records one file keeps. The newest are kept, and an ask is never split from its decision. |

### Methods

| Method | Parameters | Answer |
|---|---|---|
| `policy` | `session_id`, `cwd` | `{ mode }`. A session with no file answers with the configured mode. |
| `set_policy` | `session_id`, `cwd`, `mode` | `{ mode }`. `-32602` for a mode outside the three; setting the mode a session already has changes nothing. |
| `request` | `session_id`, `cwd`, `tool`, `call_id?`, `reason?`, `subagent?` | `{ outcome }`, one of `allowed-once`, `rejected`, `cancelled`, `unavailable`. |
| `answer` | `id`, `decision` | `{ settled: true }`. `decision` is `allow` or `deny`; a late or unknown `id` is `-32602`. |
| `pending` | `session_id?` | `{ requests }`: the questions still waiting, each with `id`, `session_id`, `tool`, `at` and the optional `call_id`, `reason` and `subagent`. |
| `register_answerer` | none | `{ answerers }`. Keyed by the caller label, so one plugin owns one entry. |
| `unregister_answerer` | none | `{ answerers }`. |

### Events

| Topic | Payload |
|---|---|
| `permission.requested` | `{ id, session_id, tool, call_id?, reason?, subagent?, at }`. Published only when a question is actually parked. |
| `permission.settled` | `{ id, outcome, decided_by, at, subagent? }`. |

Both are best effort: a subscriber that missed one rebuilds from `pending` and the file.

### A subagent's question

A call a subagent made reaches the gate under the parent's identity: the parent's `session_id`, the id of the call that started the subagent as `call_id`, the tool the subagent actually called, and a `subagent` label of `{ id, type?, description? }`. Everything the gate answers with therefore lands where the delegation is: the published question carries the label, so a card can appear under the parent's `task` row and say which subagent is asking, and both the `asked` and the `decided` record keep it, so the audit reads the same way after a restart.

The label is carried rather than checked, because only the caller knows which run it is in. An object without a usable `id` is refused with `-32602`, and an absent label simply means the session itself asked.

### The audit file

| Field | Meaning |
|---|---|
| `schema_version` | `1`. |
| `session_id`, `cwd` | The session the file belongs to and the working directory it was resolved for. |
| `mode` | The session's own choice, or `null` when it never made one and the configured fallback applies. |
| `records` | The records, oldest first: `policy`, `asked` and `decided`. An `asked` and a `decided` carry the `subagent` label when a subagent made the call, and `policy` never does. |

### Dependencies and config

| Entry | Meaning |
|---|---|
| `provides permission@1.0.0` | The capability itself. It requires nothing: the gate is a leaf. |
| `configKeys` | `mode`, `dir`, `max_records`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: the methods, the waiting registry, the audit appends, `selfCheck`. |
| [`src/store.ts`](src/store.ts) | The file model: `encodeDir`, `read`, `write`, the decision table, the pairing invariant and the subagent label it validates. |

### One decision table

`decide(mode, answerers)` is the whole policy: `full` and `auto` answer `allowed-once` with `decided_by` set to `policy:full` or `policy:auto`; `ask` with no registered answerer answers `unavailable` with the cause `no-answerer`; `ask` with an answerer returns the one word that is not an answer, and the caller parks a question. Because the table is one function, a mode that has not been thought through cannot quietly become an approval.

### A question is published before it is waited for

`request` appends the `asked` record and publishes `permission.requested` first, then parks. An answerer that is already listening can therefore answer while the caller is still arriving at its wait, and an answer that arrives in that window is not lost. The parked question is registered with its own abort listener, so cancelling the call, or shutting the plugin down, settles the question as `cancelled` and writes the paired `decided` record rather than leaving a dangling ask.

The label a subagent sent travels with the question rather than with the answerer, so a subscriber that arrives late still sees it in `pending`, and the record that pairs the ask with its decision keeps it without the gate having to remember which run was asking.

### The pairing invariant

`pairingProblems` is the check the plugin runs over its own output: every `asked` has exactly one `decided` with the same id, and a `decided` without an `asked` is only legal when its `decided_by` starts with `policy:`. `trim` keeps the newest `max_records` records and drops a leading decision whose question was cut, so the invariant survives truncation.

### Why the write is not the session store

The atomic write is a copy of the pattern in `packages/session/src/store.ts` (serialize to a temporary name, then rename over the target), not an import of it. A plugin owns its own files, and copying eight lines is cheaper than making the gate depend on a package that knows nothing about it.

-----

<a id="further-exploration"></a>
## Further exploration

- [Permission design](../../../docs/user/permission.md): where the gate sits and what it deliberately does not do.
- [tool-pwsh](../../shell/tool-pwsh/README.md): the tool that asks.
- [interaction group](../README.md): how the asking and the deciding divide the work.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No rule table**: nothing here knows what a destructive command looks like. The tool that runs a command decides, and the gate only carries the question.
- **No remembered grant**: the sole grant is `allowed-once`, so a user who approves the same command twice answers twice. A remembered rule is a policy decision this version does not ship.
- **No arbitration**: the first answer wins, and every registered answerer may answer every question.
- **The subagent label is carried, never verified**: any caller may name any subagent, and nothing downstream of the caller can tell a delegation from a session's own call beyond what it was told.
- **Registrations do not survive a restart**: they live in memory, keyed by caller label, and a deployment that restarts with a question parked settles it as `cancelled`.
- **Best-effort events**: a subscriber that missed `permission.requested` learns the question from `pending` instead, so anything built on the stream must still reconcile.
