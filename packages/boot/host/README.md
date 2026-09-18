---
description: "Spawn the eggshell kernel from Node and drive it: invoke capabilities, stream chunks, subscribe to events, and shut it down over the kernel's stdio protocol."
kind: "package-reference"
---

# @virgena/maota-boot-host

English | [中文](README.zh.md)

## Summary

Boot one eggshell kernel as a child process and talk to it from Node: ask for the capability table, invoke a capability, consume a stream of chunks, subscribe to kernel events, and shut the process down with a reason. The host owns framing, backpressure, cancellation and the failure text you see when a kernel dies, so callers never touch raw stdio. Use it from any Node front end; the CLI and the smoke tests are the current callers. It does not resolve paths or read configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`boot()` resolves once the kernel has answered `capabilities`, so a returned host is a live, wired process:

```ts
import { boot } from "../../boot/host/src/index.ts";

const kernel = await boot(configPath, { bin });
const table = await kernel.capabilities();
const stream = await kernel.invoke("agent.loop", "run", { input: "hi" }, { stream: true });
for await (const chunk of stream) console.log(chunk.data);
process.exit(await kernel.shutdown("ui_quit"));
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `bin` | `EGGSHELL_BIN`, else `eggshell` | Kernel binary to spawn. |
| `cwd` | the parent's cwd | Working directory for the child. |
| `env` | `process.env` | Environment for the child. |
| `onLog` | write stderr through | Callback for each JSON log line the kernel writes to stderr. |

### Call surfaces

| Call | Meaning |
|---|---|
| `capabilities()` | The capability table: capability id to providing plugin and version. |
| `invoke(capability, method, params?)` | One request, one reply; rejects with `KernelError`. |
| `invoke(capability, method, params, { stream: true })` | A chunk stream as an `AsyncIterable`; breaking out of it cancels the call. |
| `subscribe(patterns)` | An `AsyncIterable` of matching kernel events. |
| `on(patterns, handler)` | The same events through a callback; returns an unsubscribe function. |
| `shutdown(reason)` | Ask for shutdown, then resolve with the child's exit code. |
| `exited` | The child's exit code as a promise, without asking for shutdown. |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals: click to expand</summary>

Both directions use the kernel's framing: a `Content-Length` header, a blank line, then one JSON body. Replies settle the pending call by id; `$/stream/chunk`, `$/stream/error` and `$/event` are notifications. Chunks that arrive before the consumer starts iterating are parked per stream id and replayed when it does, and a stream that never gets a consumer is parked until the process ends. Queued bytes above 1 MiB pause the child's stdout; below 256 KiB it resumes. Leaving a stream early sends `$/cancel` for it. `shutdown` sends the request and waits for the exit; the reason is `ui_quit` or `kernel_exit`. When the child dies, the host keeps the last 32 stderr lines, finds the last one that looks like a kernel report, and expands its `errors[]` into the thrown message. A provider that dies mid-flight makes later calls to its capability fail with `-32011`; an unknown capability fails with `-32010`.

| File | Contents |
|---|---|
| [`src/index.ts`](src/index.ts) | `boot`, `Host`, `KernelError`, `Queue`, framing helpers, `Chunk` and `Event` types |

</details>

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Subscription patterns match whole topic segments; `*` matches one segment and `**` never matches, so there is no recursive wildcard.
- Events published before the kernel has acknowledged a new subscription are not replayed.
- A handler passed to `on` that throws ends that subscription silently.
- `shutdown` always resolves; a kernel that ignores the request leaves the caller waiting for the process to exit.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers: click to expand</summary>

The bridge smoke test is the behavioural contract for this package: boot, capabilities, invoke, stream, cancel-on-break, subscribe, on, and shutdown with a reason. It needs a real kernel binary and a fixture plugin, so it is not part of `pnpm check`.

</details>
