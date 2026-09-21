---
description: "hook 方言：四个事件、各自带的 payload、hook 用什么作答，以及多份答案怎么合成一份，写给 hook 作者与桥接方。"
kind: "package-reference"
---

# hook-protocol

[English](README.md) | 中文

## 概述

hook 写作时用的词，也是引擎作答时用的词。它只有一个文件、零依赖：四个事件名、每个事件带的 payload、hook 写下的回复与多份回复合成的那份结果、`hook.*` 提供者契约，以及决定谁的意见算数的合并规则。这里没有任何东西认识循环、会话或进程，所以 hook 插件、调用它的引擎、以及把结果往下传的桥都可以 import 它，而不必互相 import。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 四个事件

| 事件 | payload | 引擎什么时候问 |
|---|---|---|
| `UserPromptSubmit` | `{ session_id, cwd, input }` | 提示词到达模型之前，也还没被写下来之前。 |
| `PreToolUse` | `{ session_id, cwd, step, tool, args, call_id }` | 一次工具调用被派发之前，也被分类之前。`args` 是这个工具将会收到的参数，主机参数已经注入。 |
| `PostToolUse` | 前一个事件的 payload 加上 `{ ok, output }` | 这次调用已经落定、它的结果还没写回去之前。 |
| `Stop` | `{ session_id, cwd, steps, stop_active }` | 模型没有要求任何工具调用时，也就是一轮本来要结束的那一刻。 |

一轮没有工作目录时 `cwd` 是 `null`。`call_id` 是模型给这次调用的 id，因此一份回复可以对上它谈的是哪一次调用。

### hook 用什么作答

每个事件一个同名方法，参数就是该事件的 payload，返回一份 `HookReply`，或者用 `null` 表示没有意见。

| 字段 | 含义 |
|---|---|
| `decision` | `allow` 或 `deny`。`deny` 是真的拒绝：被拒的提示词不会被存下、也到不了模型，被拒的调用不会被派发、也不会被分类。`allow` 本身不放行任何东西，因为分类和工具自己的审批照旧执行。 |
| `reason` | 拒绝的理由。合并后只有拒绝那一档的理由活下来，它们就是模型被告知的内容。 |
| `context` | 这个 hook 想注进对话的文本，一条一个消息。写纯文本即可：来源由引擎替你盖章。 |
| `preventContinuation` | 工具调用之后，请求结束这一轮。只要有一个 hook 请求就够。 |
| `steer` | 在 `Stop` 上，结束之前还想再说一句。第一个给出它的 hook 提供这句话。 |

返回 `null`、空对象，或者什么都不返回的 hook 没有意见，不影响结果。

### 提供者契约

hook 就是一个提供 `hook.<name>` 能力的插件，其中名字满足 `^[a-z][a-z0-9._-]*$`。

| 方法 | 参数 | 回答 |
|---|---|---|
| `describe` | 无 | `{ events }`：这个 hook 实现了哪些事件，类型是 `HookEvent[]`。必填。没有可用的 `describe` 的 `hook.*` 能力会被跳过并记一条 warning，而不是照样被调用。 |
| 每个已声明事件的同名方法 | 该事件的 payload | `HookReply` 或 `null`。 |

`HOOK_EVENTS`、`isHookEvent`、`isHookCapability`、`HOOK_CAPABILITY_PREFIX` 与 `hookLabel` 是围绕这些名字的校验与盖章助手。

### 多个答案怎么合并

`mergeHookOutcomes(contributions, event, maxContextChars)` 把每份回复合成一份 `HookOutcome`，这些规则看的是严格度，不是顺序：

| 字段 | 规则 |
|---|---|
| `decision` | 一个 `deny` 压过任意多个 `allow`。 |
| `reason` | 只保留拒绝那一档的理由，用空行连接。没有写理由的拒绝也会说出一句话。 |
| `context` | 每份回复里每个非空字符串，按 hook 顺序累积，按 `maxContextChars` 逐条截断，并盖上它来自哪个 hook。即使结果是被拒绝，放行方的 context 也会保留。 |
| `preventContinuation` | 任意一份回复请求过就是真。 |
| `steer` | 第一条非空的。 |

一个字段都没设的结果，等同于根本没有配置 hook，而 `clipContext(text, maxChars)` 就是合并所用的截断，也导出给想要同一套规则的调用方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部内容：事件、payload、回复与结果形状、助手函数与合并。 |

### 方言为什么住在这里

扩展点属于持有它的那个包，所以循环只声明自己消费的决策、一个 hook 字都没有，而 hook 这一侧只持有 hook 的名字、不认识循环。这个包就是让这件事成立的东西：它是叶子，两侧都可以 import 它，而且像 `preventContinuation` 这样的字段名只在这里出现。把 `HookOutcome` 映射到循环决策的那座桥，把映射写在自己的文件里。

### 合并看的是严格度，不是顺序

扇出按能力名升序，好让结果可复现，但没有哪个字段依赖这个顺序：context 按被问到的顺序累积，`preventContinuation` 是任意为真即为真，`steer` 取第一个给出的。唯一能让一个 hook 压过一群的字段是 `decision`，这是刻意的：拒绝绝不能因为别人说好而被稀释。

-----

<a id="further-exploration"></a>
## 进一步探索

- [hooks-native](../hooks-native/README.zh.md)：调用这些 hook 并合并其答案的引擎。
- [agent-core](../../agent/agent-core/README.zh.md)：把结果映射成循环决策的那座桥。
- [hooks 包](README.zh.md)：这份方言所属的组。
- [四个 hook 点](../../../docs/hooks.zh.md)：这四个事件落在一轮里的哪个位置。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只有四个事件**：更宽的 hook 生态里有更多名字，包括这一版不带的二十来个。要加一个，先加在这里。
- **不改写输入**：hook 决定一次调用跑不跑，从不改动它跑起来时用的参数。
- **没有 `ask` 档决策**：hook 可以放行或拒绝，但没法把这个问题交给一个人。
- **停机不留类型上的痕迹**：hook 不上报自己决定过什么，因为决策只会因为它注入的 context 消息落进某个会话而变成持久的东西。
