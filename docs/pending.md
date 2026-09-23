# Unfinished work

English | [中文](pending.zh.md)

The v5 pass rebuilt the skills chain, the hook points and the permission gate, and left four blocks of that plan unbuilt. This page is the backlog for them. Every entry below was checked against the code on 2026-09-22 and is not in it today, with the file that would change. An entry leaves this page by being built, not by being reworded, and when the last one goes this page goes with it.

`docs/CONVENTIONS.md` keeps unfinished work out of a README. This page is the one place it belongs.

## Table of Contents

- [Shell and PowerShell](#shell-and-powershell)
- [Subagents](#subagents)
- [Todos](#todos)
- [Front end and boot](#front-end-and-boot)
- [Recovery and translation](#recovery-and-translation)
- [Leftovers](#leftovers)

## Shell and PowerShell

`packages/shell/` runs one command in one child process and answers once, and that is the whole of what exists.

- **Streaming**: nothing reports output while a command runs. `ShellRunRequest` has no `onChunk` (`packages/shell/shell/src/types.ts`) and `runPwsh` buffers to the end (`packages/shell/pwsh-local/src/pwsh.ts`), so a caller that wants live output has no path to it, on the wire included, where `call.stream` already exists (`packages/plugin-kit/src/plugin.ts`).
- **`env` and `argv`**: a request carries `command`, `workdir` and `timeout_ms` only. Nothing lets a caller add environment variables, and nothing runs a program without a shell in between.
- **A reusable shell**: there is no `shell.session`, so every run pays for a new PowerShell process and a long command cannot be started and left running.
- **Spill**: output past `max_output_bytes` is dropped; the result says `truncated` and has no path to the rest.
- **One budget**: `take()` gives stdout and stderr the full budget each, so a run can return twice the configured maximum. The plan counts them together.
- **Kill ladder**: a timeout calls `child.kill()` once and reports `timed_out`. Nothing terminates politely, waits, then forces, so a command that ignores the first kill holds the run; `ShellRunResult` has no `forced`.
- **Destructive classification**: whether a command needs approval comes from the `RISKY` list inside the tool (`packages/shell/tool-pwsh/src/approval.ts`), not from `permission` rules, so a deployment cannot change it without a release.
- **`justification`**: the tool has no parameter for why a command is being run; an approval carries a `reason` the tool wrote and nothing the caller did.
- **`max_timeout_ms`**: the provider's `timeout_ms` is a default, not a ceiling, so a caller's larger value runs uncapped.
- **Two facts for the README**: there is no sandbox, and `signal` in a result is a name for "the kill was a terminate" rather than a POSIX signal.

## Subagents

- **Depth**: nothing counts delegations, so a subagent can spawn a subagent without limit. The plan wants `max_depth`, 1 by default and 3 at most.
- **Identity of the child**: the tool returns the child's last message and not the session it ran as, so nothing can be inspected or resumed afterwards.
- **`resume`**: no way to continue an earlier child.
- **`background`**: no fire-and-forget delegation, and no event when it ends.
- **Agent definitions**: `$MAOTA_HOME/agents/<name>.md` is not read; the two kinds of subagent are built in.
- **`context: "fork"`**: a child cannot be handed the parent's history. The skill `context: fork` in `packages/agent/agent-core/src/control.ts` is a different feature that shares the name.
- **`output_schema`**: a child answers in prose; nothing validates the answer and nothing re-asks once when it does not parse.
- **`child_timeout_ms`**: there is no deadline per child.
- **One fact for the README**: the cap on children running at once is per process.

## Todos

- **`op`**: `tool.todo_write` replaces the whole plan. There is no create, update or get.
- **`depends_on`**: items have no edges between them.
- **`in_progress`**: no count of the items in progress, and no word to the model when several are.
- **`todo.changed`**: nothing publishes a plan change, so a front end can only poll.
- **Plans on disk**: the plan is stored through `session.save_todos`. Its own file, `$MAOTA_HOME/plans/<session>.json`, does not exist.
- **One fact for the README**: the verification nudge is advice, not a gate.

## Front end and boot

- **`serve --port` and `--host`**: neither option exists (`apps/cli/src/args.ts`), so the port comes from the profile's config, and startup has no deadline of its own.
- **`maota session list|show|rm`**: the CLI has `serve`, `check` and a one-shot question only (`apps/cli/src/index.ts`).
- **`maota config get|set`**: no such command, and no `$MAOTA_HOME/settings.toml` to read or write.
- **Import graph**: `apps/cli/src/graph.ts` follows a literal `import "x"` and `import("x")`, but not a constant one.
- **hmr**: watches the roots it is given and nothing else, so `configKeys` is `["roots"]` (`packages/boot/hmr/src/index.ts`): no `ignore`, no `debounce_ms`, and no fallback to the nearest existing ancestor when a root does not exist yet.
- **host**: a handler that throws is neither logged nor unsubscribed, a `*` in a topic pattern matches one segment only (`packages/plugin-kit/src/channel.ts`), and `shutdown` waits with no deadline (`packages/boot/host/src/index.ts`), so a wedged kernel holds the CLI up.
- **One fact for the README**: ordering between plugin rows is not load bearing, which is why nothing checks it.

## Recovery and translation

Recovery decides what to do about a failed model call, and the translation store holds the interface's words. Both were built with some of what they could do left out on purpose.

- **Output allowance**: a failure that a longer answer would fix is not answered by raising the allowance, because `packages/api/src/retry.ts` has no key for it and the loop no path to it. A deployment that wants escalation writes it as another plugin.
- **Another model**: there is no fallback model. `packages/api/src/index.ts` holds one `model` per profile, and nothing in the recovery path can name a second.
- **The retraction is whole**: a retry retracts the entire streamed attempt back to its start rather than the part worth replacing (`apps/web/ui/src/components/MessageList.tsx`).
- **The CLI is English only**: `apps/cli/` holds no dictionary and never asks the store, so the translated interface is the web UI alone, and every string the CLI prints is a literal (`apps/cli/src/index.ts`). The plan counts the CLI as a front end.
- **The app's own language choice**: the web UI keeps it in `localStorage` under `maota.lang` while the profile holds a `locale` of its own, so a browser and a headless run can disagree about the language and neither knows (`apps/web/ui/src/lib/i18n.ts`).
- **`translate` does not format**: it answers the word as written, so a caller with values to fill in calls `format` itself (`i18n/i18n-native/src/plugin.ts`).
- **Words are flat strings**: no plural forms and no markup, so a language that needs either is written as several keys (`i18n/i18n-protocol/src/index.ts`).
- **A contributor is read once per discovery**: the store rebuilds when the capability table changes and not when a contributor's own words do (`i18n/i18n-native/src/plugin.ts`).

## Leftovers

- `.tmp-maota-config`, left behind by a `maota check` run with a scratch `MAOTA_HOME`, is still in the working tree.
- The root `check` chain holds 40 steps. The smoke tests for everything above are waiting on the code they would exercise.