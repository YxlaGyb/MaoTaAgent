# Permission

English | [中文](permission.zh.md)

MaoTa runs commands and edits files on the user's own machine, so one decision has to come from the user: whether an operation runs at all. This document owns that gate: where it sits, what it answers, what it writes down, and what it deliberately leaves out. The gate is a plugin, not a kernel feature; the kernel routes `permission` like any other capability and never inspects a command.

## Table of Contents

- [Where the gate sits](#where-the-gate-sits)
- [The three modes](#the-three-modes)
- [The contract](#the-contract)
- [The audit file](#the-audit-file)
- [The card and the wire](#the-card-and-the-wire)
- [What this does not cover](#what-this-does-not-cover)
- [Related documentation](#related-documentation)

-----

<a id="where-the-gate-sits"></a>
## Where the gate sits

Every tool call goes through one funnel: `agent-core` calls the `tools` capability, the dispatcher looks the tool up and forwards the arguments to `tool.<name>/run`. That funnel is also where a gate belongs, because it is the last point at which a call can be stopped before it touches the machine.

This version puts the gate one step inside that funnel: the tool itself, not the dispatcher, decides whether an operation needs an answer and asks for it. There is exactly one ask originator, `tool-pwsh`, and it stops on three shapes (`rm `, `> /etc/`, `chmod 777`). No rule table ships, because what counts as destructive is a property of the tool that would run it: a second tool that wants a gate makes the same `permission/request` call and needs no change here.

`tools.call` remains the documented extension point for a gate that sits centrally; this version does not implement that forwarding. Either way the kernel knows nothing: no tool, no command, no permission.

<a id="the-three-modes"></a>
## The three modes

The mode is per session and per working directory, so one project can run unattended while another waits for a person.

| Mode | A flagged operation | What is written down |
|---|---|---|
| `ask` | A question is published and the call waits for an answer. | The question, and the answer it got. |
| `auto` | The call is approved without asking. | A decision, attributed to `policy:auto`. |
| `full` | The tool does not even evaluate its own command line, and never asks. | Nothing: the operation is not a question. |

`ask` is the default, and it is the only mode that can stop a call. The choice itself is audited, so a session that was switched to `full` says when it was switched and by whom.

The tool reads the mode before every call, which is why switching modes takes effect on the next command rather than the next launch. The mode is stored with the session, so it survives a reload of the page or a restart of the deployment.

<a id="the-contract"></a>
## The contract

The plugin provides `permission` at version `1.0.0` and reads three config keys: `mode` (the fallback for a session that never chose one, default `ask`), `dir` (default `$MAOTA_HOME/permissions`), and `max_records` (default `500`).

| Method | Parameters | Answer |
|---|---|---|
| `policy` | `session_id`, `cwd` | `{ mode }`: the session's own choice, or the configured fallback. A session with no file gets the fallback, not an error. |
| `set_policy` | `session_id`, `cwd`, `mode` | `{ mode }`. A mode outside the three is `-32602`. Setting the mode the session already has changes nothing and appends no record. |
| `request` | `session_id`, `cwd`, `tool`, optional `call_id`, optional `reason` | `{ outcome }`. See the vocabulary below. |
| `answer` | `id`, `decision` (`allow` or `deny`) | `{ settled: true }`. A late or unknown id is `-32602` and the answer is dropped. |
| `pending` | optional `session_id` | `{ requests }`: every question still waiting, so a page that reloaded can rebuild its cards. |
| `register_answerer` / `unregister_answerer` | none | `{ answerers }`. One entry per plugin, keyed by its caller label, so a restarted front end replaces its own registration. |

`request` answers with one of four outcomes, and only the first is a grant:

| Outcome | Meaning |
|---|---|
| `allowed-once` | This one call may run. Nothing is remembered: the next matching operation asks again. |
| `rejected` | A person said no, or a policy said no. |
| `cancelled` | The question was withdrawn before a decision, or the call was cancelled. |
| `unavailable` | Nobody can answer: no answerer is registered, or the question could not be asked. |

Only `ask` with at least one registered answerer publishes a question. `auto` and `full` answer `allowed-once` immediately, with `decided_by` set to `policy:auto` or `policy:full`, and publish nothing. Anything that is not `allowed-once` is a refusal, and a refusal is what the caller must act on: an absent capability, a call that threw, and an answer outside the four words all collapse to `unavailable`, so no failure path can turn into a silent yes.

Two events are published, best effort: `permission.requested { id, session_id, tool, call_id?, reason?, at }` and `permission.settled { id, outcome, decided_by, at }`. They are notifications for a front end that happens to be listening. The durable file and `pending` are the truth; a lost event costs a repaint, never a decision.

A request deliberately carries no tool arguments. The front end matches a question to the tool call it belongs to through `call_id`, which `agent-core` injects as a host argument from the id of the call the model asked for.

<a id="the-audit-file"></a>
## The audit file

One file per session per working directory: `$MAOTA_HOME/permissions/<cwd>/<session_id>.json`, where the directory encodes the working directory the same way the session store does and an empty one becomes `default`.

```json
{
  "schema_version": 1,
  "session_id": "…",
  "cwd": "E:\\work",
  "mode": "ask",
  "records": [
    { "kind": "asked", "at": "…", "id": "…", "tool": "pwsh", "call_id": "…", "reason": "…" },
    { "kind": "decided", "at": "…", "id": "…", "outcome": "allowed-once", "decided_by": "web" }
  ]
}
```

The file obeys one invariant: every `asked` has exactly one paired `decided` with the same `id`. A `decided` with no `asked` is legal only for a decision the policy made by itself, which is why it carries a `decided_by` that starts with `policy:`. Trimming to `max_records` keeps the newest records and never splits an ask from its decision; a head that lost its question goes with it.

Writes follow the session store: the whole file is serialized to a temporary name and renamed over the target, so a reader never sees half a record. Policy changes are records too, of `kind: "policy"`.

<a id="the-card-and-the-wire"></a>
## The card and the wire

The web plugin is the only answerer this version ships. It registers itself at start, subscribes to the two topics, forwards them to the page as `permission.request` and `permission.settled`, and offers four RPC methods on top of the ones the page already had: `permission.get`, `permission.set`, `permission.answer` and `permission.pending`. The page renders one card per waiting question, matched to the tool call that is already streaming by `call_id`, and rebuilds its cards from `permission.pending` after a reload or a reconnect.

The card offers two answers and no memory: allow this one call, or deny it. There is no "always allow", because a remembered grant is a rule, and rules are what this version does not ship.

The mode picker is not a page-local setting either: it reads the session's mode from the plugin and writes it back there. It is disabled while there is no session and while a round is running, so the mode cannot change under a call that already read it.

The CLI registers no answerer. An `ask` deployment driven from a terminal therefore refuses a flagged command and writes the reason into the tool result, which is the intended fail-closed answer, not a defect: a front end that cannot ask must not approve.

<a id="what-this-does-not-cover"></a>
## What this does not cover

- The gate decides whether an operation runs. It decides nothing about what the operation may touch once it runs: the file tools keep their own workspace containment, and a shell command is still bounded only by the shell provider.
- No classifier decides what is destructive. The one ask originator reads three fixed shapes, and a command that hides a destructive act outside those shapes is not flagged.
- No rule table, no hard deny list, and no remembered grant: every flagged operation is a fresh question.
- No multi-answerer arbitration. Every registered answerer may settle a question, and the first answer wins.
- No sandbox. A permitted command runs the way it always ran.

<a id="related-documentation"></a>
## Related documentation

- [interaction package group](../packages/interaction/README.md): the gate package and how it is mounted.
- [tool-pwsh](../packages/shell/tool-pwsh/README.md): the tool that asks.
- [tools dispatcher](../packages/agent/tools/README.md): the funnel the gate is documented against.
- [architecture](architecture.md): where this gate sits in the whole system.
