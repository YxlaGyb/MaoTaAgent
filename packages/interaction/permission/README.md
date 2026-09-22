---
description: "The permission plugin: the per-session mode, the rules that decide before it, the remembered answers, the questions waiting for an answer, the four outcome words, and the audit file that pairs every ask with its decision."
kind: "package-reference"
---

# permission

English | [中文](README.zh.md)

## Summary

One capability, `permission`, that a tool calls before it does something the user should decide about. It holds a mode per session and working directory, applies a table of rules the profile configured, parks a question until somebody answers it, and answers with one of four words of which only `allowed-once` is a grant. An answer may be remembered, in which case later calls of the same tool are settled by the file rather than by a person. Every asked question is paired with its decision in an audit file that survives a restart, and both the mode and a remembered answer are audited when they change. Registrations are per plugin, so a front end that restarts replaces its own.

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
| `mode` | string | `ask` | The mode a session falls back to before it chooses one of its own. One of `ask`, `auto`, `full`. |
| `dir` | string | `$MAOTA_HOME/permissions` | Where the audit files live. One directory per working directory, one file per session. |
| `max_records` | integer | `500` | How many records one file keeps. The newest are kept, and an ask is never split from its decision. |
| `rules` | array | `[]` | `{ match, action }` entries, read in order, the first one whose `match` matches the tool name deciding. `action` is `allow`, `deny` or `ask`. |
| `remember` | boolean | `false` | Whether an `answer` of `allow` should apply to every later call of the same tool instead of only the question that was asked. |

### Methods

| Method | Parameters | Answer |
|---|---|---|
| `policy` | `session_id`, `cwd` | `{ mode, grants }`. A session with no file answers with the configured mode and no grants. |
| `set_policy` | `session_id`, `cwd`, `mode` | `{ mode }`. `-32602` for a mode outside the three; setting the mode a session already has changes nothing. |
| `request` | `session_id`, `cwd`, `tool`, `call_id?`, `reason?`, `subagent?` | `{ outcome }`, one of `allowed-once`, `rejected`, `cancelled`, `unavailable`. A `call_id` that the named session never made is a `-32602` when the session store is reachable. |
| `answer` | `id`, `decision`, `remember?` | `{ settled: true }`. `decision` is `allow` or `deny`; a late or unknown `id` is `-32602`. `remember` defaults to the configured `remember`. |
| `forget` | `session_id`, `cwd`, `tool?` | `{ grants }`. Withdraws one remembered answer, or every one when `tool` is absent. |
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

The label is carried rather than checked, because only the caller knows which run it is in. The `call_id` it arrives with is a different matter: it names a call, and when the session store is reachable the gate reads the session and refuses a `call_id` no message carries. An object without a usable `id` is refused with `-32602`, and an absent label simply means the session itself asked.

### The audit file

| Field | Meaning |
|---|---|
| `schema_version` | `2`. |
| `session_id`, `cwd` | The session the file belongs to and the working directory it was resolved for. |
| `mode` | The session's own choice, or `null` when it never made one and the configured fallback applies. |
| `grants` | The tools whose question was answered with `remember`: a call of one of them is settled without asking. |
| `records` | The records, oldest first: `policy`, `asked`, `decided` and `grant`. An `asked` and a `decided` carry the `subagent` label when a subagent made the call, and `policy` never does. A `grant` is a remembered answer, and carries `revoked: true` when it was withdrawn. |

### Dependencies and config

| Entry | Meaning |
|---|---|
| `provides permission` | The capability itself. It requires nothing: the gate is a leaf, and the `session` capability is read only when it happens to be there. |
| `configKeys` | `mode`, `dir`, `max_records`, `rules`, `remember`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: the methods, the waiting registry, the audit appends, `selfCheck`. |
| [`src/store.ts`](src/store.ts) | The file model: `encodeDir`, `read`, `write`, the decision table, the pairing invariant and the subagent label it validates. |

### One decision table

`decide(mode, answerers, tool, rules, grants)` is the whole policy, strictest first: a rule whose `action` is `deny` refuses, a remembered grant allows, a rule whose `action` is `allow` allows, and a rule whose `action` is `ask` asks whoever is listening whatever the mode says. Only then does the mode decide: `full` and `auto` answer `allowed-once` with `decided_by` set to `policy:full` or `policy:auto`, and `ask` with no registered answerer answers `unavailable` with the cause `no-answerer`. Everything that asks with an answerer returns the one word that is not an answer, and the caller parks a question. Because the table is one function, a mode that has not been thought through cannot quietly become an approval, and a rule that wants a person asked cannot be talked out of it by a mode.

### A question is published before it is waited for

`request` appends the `asked` record and publishes `permission.requested` first, then parks. An answerer that is already listening can therefore answer while the caller is still arriving at its wait, and an answer that arrives in that window is not lost. The parked question is registered with its own abort listener, so cancelling the call, or shutting the plugin down, settles the question as `cancelled` and writes the paired `decided` record rather than leaving a dangling ask.

The label a subagent sent travels with the question rather than with the answerer, so a subscriber that arrives late still sees it in `pending`, and the record that pairs the ask with its decision keeps it without the gate having to remember which run was asking.

### The pairing invariant

`pairingProblems` is the check the plugin runs over its own output: every `asked` has exactly one `decided` with the same id, and a `decided` without an `asked` is only legal when its `decided_by` starts with `policy:`. `trim` keeps the newest `max_records` records and drops a leading decision whose question was cut, so the invariant survives truncation.

### Why the write is not the session store

The atomic write is a copy of the pattern in `packages/session/src/store.ts` (serialize to a temporary name, then rename over the target), not an import of it. A plugin owns its own files, and copying eight lines is cheaper than making the gate depend on a package that knows nothing about it.

Six facts bound this gate. Nothing here knows what a destructive command looks like: the tool that runs a command decides, and the gate only carries the question. A grant is `allowed-once` unless the answer was remembered, and a remembered answer covers every later call of that tool until `forget` withdraws it, which is what makes it worth asking about. The first answer wins and every registered answerer may answer every question, so there is no arbitration. Rules are matched against the tool name in the order they were configured, and nothing else about the call is consulted. Registrations live in memory keyed by caller label, so a deployment that restarts with a question parked settles it as `cancelled`, while the grants and the mode were written down and survive the restart. And events are best-effort: a subscriber that missed `permission.requested` learns the question from `pending` instead, so anything built on the stream must still reconcile.

-----

<a id="further-exploration"></a>
## Further exploration

- [Permission design](../../../docs/user/permission.md): where the gate sits and what it deliberately does not do.
- [tool-pwsh](../../shell/tool-pwsh/README.md): the tool that asks.
- [interaction group](../README.md): how the asking and the deciding divide the work.
