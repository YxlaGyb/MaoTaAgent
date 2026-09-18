---
description: "从 Node 拉起 eggshell 内核并驱动它：在内核的 stdio 协议上 invoke 能力、收流、订阅事件、停机。"
kind: "package-reference"
---

# @virgena/maota-boot-host

[English](README.md) | 中文

## 摘要

把一个 eggshell 内核当子进程拉起来，再从 Node 这一侧跟它说话：要能力表、invoke 一个能力、消费一条分片流、订阅内核事件、带原因让它停机。帧、背压、取消，以及内核死掉时你看到的那段失败说明都归宿主管，所以调用方永远不碰裸 stdio。任何 Node 前端都可以用它；今天的调用方是 CLI 与冒烟测试。它不定路径、不读配置。

## 目录

- [怎么用这个包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 怎么用这个包

`boot()` 在内核答出 `capabilities` 之后才 resolve，所以拿到的宿主是一个已经接好线的活进程：

```ts
import { boot } from "../../boot/host/src/index.ts";

const kernel = await boot(configPath, { bin });
const table = await kernel.capabilities();
const stream = await kernel.invoke("agent.loop", "run", { input: "hi" }, { stream: true });
for await (const chunk of stream) console.log(chunk.data);
process.exit(await kernel.shutdown("ui_quit"));
```

### 选项

| 选项 | 缺省 | 含义 |
|---|---|---|
| `bin` | `EGGSHELL_BIN`，再退到 `eggshell` | 要拉起来的内核二进制。 |
| `cwd` | 父进程的 cwd | 子进程的工作目录。 |
| `env` | `process.env` | 子进程的环境变量。 |
| `onLog` | 直接把 stderr 透出去 | 内核写到 stderr 的每条 JSON 日志行的回调。 |

### 调用面

| 调用 | 含义 |
|---|---|
| `capabilities()` | 能力表：能力 id 到提供方与版本。 |
| `invoke(capability, method, params?)` | 一来一回；失败以 `KernelError` reject。 |
| `invoke(capability, method, params, { stream: true })` | 以 `AsyncIterable` 给出的分片流；提前跳出即取消这次调用。 |
| `subscribe(patterns)` | 匹配到的内核事件构成的 `AsyncIterable`。 |
| `on(patterns, handler)` | 同一批事件走回调；返回退订函数。 |
| `shutdown(reason)` | 请求停机，然后 resolve 出子进程的退出码。 |
| `exited` | 不求停机，只拿子进程退出码的 promise。 |

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内幕：点击展开</summary>

两个方向都用内核的帧格式：一段 `Content-Length` 头、一个空行、一个 JSON 体。回包按 id 结掉挂起的调用；`$/stream/chunk`、`$/stream/error` 与 `$/event` 是通知。消费者还没开始迭代就到的分片会按 stream id 寄存，等它开始时补发；始终没有消费者的流会一直寄存到进程结束。排队字节超过 1 MiB 就暂停子进程 stdout，低于 256 KiB 再恢复。中途离开一条流会给它发 `$/cancel`。`shutdown` 发请求并等退出；原因是 `ui_quit` 或 `kernel_exit`。子进程死掉时，宿主保留最后 32 行 stderr，找出最后一行看起来像内核报告的行，把它的 `errors[]` 摊进抛出的消息里。提供方半路死掉，之后调它的能力会以 `-32011` 失败；不认识的能力以 `-32010` 失败。

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `boot`、`Host`、`KernelError`、`Queue`、分帧辅助函数、`Chunk` 与 `Event` 类型 |

</details>

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 订阅模式按 topic 的整段匹配；`*` 匹配一段，`**` 永不匹配，所以没有递归通配。
- 内核确认新订阅之前发布的事件不会补发。
- 传给 `on` 的 handler 抛错会静默结束那个订阅。
- `shutdown` 总会 resolve；内核若不理这个请求，调用方就一直等进程退出。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>给维护者的上下文：点击展开</summary>

桥冒烟测试是这个包的行为契约：boot、capabilities、invoke、stream、跳出即取消、subscribe、on，以及带原因的 shutdown。它需要真内核二进制与 fixture 插件，所以不进 `pnpm check`。

</details>
