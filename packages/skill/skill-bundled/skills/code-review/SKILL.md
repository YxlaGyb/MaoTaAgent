---
name: code-review
description: Review a code change for correctness and risk: what breaks at boundaries, error paths, resource cleanup, concurrency, tests, and how to report findings a reader can act on.
when-to-use: When asked to review a diff, a pull request, or a file before it is merged, in any language or project.
allowed-tools: [read, glob, grep]
---

# Reviewing a change

Read the diff first, then the code around it. The question is not whether the
change is tidy; it is whether it holds where it meets the rest of the system.

A review reads. While this skill is loaded the run is narrowed to the reading
tools, so a finding is a finding and not an unrequested edit; say what to change
and let the person decide.

## Start from the contract

For every changed function, ask what its callers are promised. A change that
quietly narrows an accepted input, widens a return type, starts returning a new
error, or alters ordering is a breaking change whether or not a test noticed.

## Validate at boundaries, trust inside

Values from anywhere outside the current process or type system need reading
rather than trusting: parsed input, configuration files, network and IPC
payloads, environment variables, data read back from disk, and anything a model
produced. Inside one process, a value the type system already guarantees should
not be re-checked, and a defensive fallback there hides the real bug.

## Follow the failure paths

- Every error path either handles the failure or lets it propagate: a swallowed
  error that turns into a default value is the most common serious defect.
- A resource acquired in one place (file, socket, child process, subscription,
  timer, lock) is released on the success path, the error path, and the
  cancellation path.
- A request that carries a cancellation signal forwards it, and a timeout is
  distinguishable from a refusal.
- Retries are bounded and idempotent; an unbounded retry on a non-idempotent
  operation is data loss waiting to happen.

## Check concurrency and state

Shared mutable state is the usual source of "works on my machine" failures.
Look for read-modify-write sequences that are not atomic, caches without an
invalidation rule, and assumptions that one call finishes before another starts.

## Tests

A behaviour change needs a case that fails before and passes after. A bug fix
without a regression test is a fix that can silently return. Tests that assert
on internals rather than behaviour will block the next refactor.

## What to report

Give file and line, what breaks, and the input that shows it. Rank by severity
rather than by where it appears in the file. Separate what you verified by
reading or running from what you suspect. Say when a problem is pre-existing and
unrelated to the change instead of folding it in. Do not rewrite the author's
style to match your own; report style only where a rule of the project states it.
