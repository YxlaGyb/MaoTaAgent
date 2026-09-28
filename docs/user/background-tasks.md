# Background tasks

English | [中文](background-tasks.zh.md)

A background task runs work after the tool call that started it has already returned. It is for independent work that would otherwise block the current turn, such as a build, test run, install, watcher or long-lived server.

## Table of Contents

- [Starting a job](#starting-a-job)
- [Reading output](#reading-output)
- [Waiting](#waiting)
- [Completion notifications](#completion-notifications)
- [Stopping a job](#stopping-a-job)
- [Ownership and lifetime](#ownership-and-lifetime)
- [Related documentation](#related-documentation)

-----

<a id="starting-a-job"></a>
## Starting a job

Use `pwsh` with `run_in_background: true` when the work is independent of the next useful step.

The tool first applies the normal permission check. If the command is allowed to start, it returns a job id immediately. The model must keep that id.

Do not start the same work again because a completion notice has not arrived yet.

<a id="reading-output"></a>
## Reading output

Use `job_output` to read output:

- Without `wait`, it returns output produced since the previous read.
- With `wait: true`, it waits for settlement or the timeout. The default wait is 30 seconds and the maximum is 10 minutes.
- A timeout does not kill the job.
- After settlement, the first read also returns the terminal result once.

Use `job_list` when the set of owned jobs is unclear.

<a id="waiting"></a>
## Waiting

Wait only when the next useful step is blocked by the job. Otherwise continue with independent work and let the completion notification arrive.

A wait marks the settlement as `awaited`, so the runner does not send a duplicate wake for the same job.

<a id="completion-notifications"></a>
## Completion notifications

`agent.runner` delivers a completion notice to the owning session. A busy session receives the follow-up after its current turn. An idle session is woken within the wake budget.

The notice contains the job id, kind, label and status. It tells the model to read output with `job_output`.

<a id="stopping-a-job"></a>
## Stopping a job

Use `job_kill` with the job id and an optional reason. Cancellation is a request. The job reaches `killed` only after the producer reports that the process or task stopped.

You can also use `maota jobs kill <id>` from the CLI.

<a id="ownership-and-lifetime"></a>
## Ownership and lifetime

A job belongs to the session that started it. Another session cannot read or stop it.

Jobs are process-local. The host must stay alive. Host shutdown cancels live jobs and removes their records. Jobs are not restored after restart.

Output retention is bounded. A read can report lossy when it has fallen behind the retained window.

<a id="related-documentation"></a>
## Related documentation

- [Jobs package group](../../packages/jobs/README.md)
- [tool-pwsh](../../packages/shell/tool-pwsh/README.md)
- [agent-runner](../../packages/agent/agent-runner/README.md)