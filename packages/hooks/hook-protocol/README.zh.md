---
description: "hook 方言：十二个事件、各自带的 payload、hook 用什么作答，以及多份答案怎么合成一份，写给 hook 作者与桥接方。"
kind: "package-reference"
---

# hook-protocol

[English](README.md) | 中文

## 概述

hook 写作时用的词，也是引擎作答时用的词。它只有一个文件、零依赖：十二个事件名、每个事件带的 payload、hook 写下的回复与多份回复合成的那份结果、`hook.*` 提供者契约，以及决定谁的意见算数的合并规则。这里没有任何东西认识循环、会话或进程，所以 hook 插件、调用它的引擎、以及把结果往下传的桥都可以 import 它，而不必互相 import。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 事件

| 事件 | payload | 引擎什么时候问 |
|---|---|---|
| `UserPromptSubmit` | `{ session_id, cwd, input }` | 提示词到达模型之前，也还没被写下来之前。 |
| `SessionStart` | `{ session_id, cwd, subagent }` | 一次 run 开始、工具还没被列出之前。 |
| `SessionEnd` | `{ session_id, cwd, subagent, steps, reason }` | 一次 run 结束时，无论它是怎么结束的。 |
| `PreToolUse` | `{ session_id, cwd, step, tool, args, call_id, subagent? }` | 一次工具调用被派发之前，也被分类之前。`args` 是这个工具将会收到的参数，主机参数已经注入。 |
| `PostToolUse` | 前一个事件的 payload 加上 `{ ok, output }` | 这次调用已经落定、它的结果还没写回去之前。 |
| `PreModel` | `{ session_id, cwd, subagent, step }` | 一次模型调用发起之前。 |
| `PostModel` | 前一个事件的 payload 加上 `{ ok }` | 这次模型调用落定、循环去读它之前。 |
| `PreCompact` | `{ session_id, cwd, subagent, messages }` | 一段长对话被折叠之前，且只在真的要折叠时才问。`messages` 是被折叠的条数。 |
| `SubagentStart` | `{ session_id, cwd, subagent_id, type, description }` | 一次委派开始、它的第一次模型调用之前。 |
| `SubagentStop` | 同 `SubagentStart` 的 payload | 一次委派结束时，无论它是怎么结束的。 |
| `Notification` | `{ session_id, cwd, text }` | 一次 run 因为模型没机会开口的原因停下时，好让某个人被告知。 |
| `Stop` | `{ session_id, cwd, steps, stop_active }` | 模型没有要求任何工具调用时，也就是一轮本来要结束的那一刻。 |

一轮没有工作目录时 `cwd` 是 `null`。`call_id` 是模型给这次调用的 id，因此一份回复可以对上它谈的是哪一次调用。

在两个工具 payload 上，`subagent` 只在调用出自子代理时出现，此时它是 `{ id, type, description }`，而 `session_id` 与 `call_id` 都是它父的。于是 hook 看到的这次子调用，位置与会话自己的调用完全一样，需要区分时也分得出来。在会话、模型与折叠这三种 payload 上，同一个词是一个布尔值，说的是这次 run 自己就是一次委派；点名它是谁的是 `SubagentStart` 与 `SubagentStop`。提示词那个点与结束那个点对子代理根本不触发。

### hook 用什么作答

每个事件一个同名方法，参数就是该事件的 payload，返回一份 `HookReply`，或者用 `null` 表示没有意见。

| 字段 | 含义 |
|---|---|
| `decision` | `allow`、`deny` 或 `ask`。`deny` 是真的拒绝：被拒的提示词不会被存下、也到不了模型，被拒的调用不会被派发、也不会被分类。`allow` 本身不放行任何东西，因为分类和工具自己的审批照旧执行。`ask` 是一个问题而不是裁决，只有认识审批层的那座桥才能对它做点什么。 |
| `reason` | 为什么拒绝、或为什么发问。合并后只有胜者的理由活下来，它们就是模型、或那个被问的人被告知的内容。 |
| `args` | 替换这次事件所谈的那次工具调用的参数。第一个给出它的 hook 提供它。 |
| `context` | 这个 hook 想注进对话的文本，一条一个消息。写纯文本即可：来源由引擎替你盖章。 |
| `output` | 在 `PostToolUse` 上替换模型被告知这次调用返回了什么。第一个给出它的 hook 提供它。 |
| `preventContinuation` | 工具调用之后，请求结束这一轮。只要有一个 hook 请求就够。 |
| `steer` | 在 `Stop` 上，结束之前还想再说一句。第一个给出它的 hook 提供这句话。 |

返回 `null`、空对象，或者什么都不返回的 hook 没有意见，不影响结果。

### 提供者契约

hook 就是一个提供 `hook.<name>` 能力的插件，其中名字满足 `^[a-z][a-z0-9._-]*$`。

| 方法 | 参数 | 回答 |
|---|---|---|
| `describe` | 无 | `{ events }`：这个 hook 实现了哪些事件，类型是 `HookEvent[]`。必填。没有可用的 `describe` 的 `hook.*` 能力，在引擎默认的 strict 模式下是一次启动失败，其他模式下被跳过并记一条 warning。 |
| 每个已声明事件的同名方法 | 该事件的 payload | `HookReply` 或 `null`。 |

`HOOK_EVENTS`、`isHookEvent`、`isHookCapability`、`HOOK_CAPABILITY_PREFIX` 与 `hookLabel` 是围绕这些名字的校验与盖章助手。

### 多个答案怎么合并

`mergeHookOutcomes(contributions, event, maxContextChars)` 把每份回复合成一份 `HookOutcome`，这些规则看的是严格度，不是顺序：

| 字段 | 规则 |
|---|---|
| `decision` | 一个 `deny` 压过任意多个 `ask` 与 `allow`，一个 `ask` 压过任意多个 `allow`。 |
| `reason` | 只保留胜出那一档的理由，用空行连接。没有写理由的胜出也会说出一句话。 |
| `args` | 第一个给出替换参数的 hook 提供它。 |
| `output` | 第一个给出替换输出的 hook 提供它。 |
| `context` | 每份回复里每个非空字符串，按 hook 顺序累积，按 `maxContextChars` 逐条截断，并盖上它来自哪个 hook。即使结果是被拒绝，放行方写下的 context 也会保留。 |
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

扇出按能力名升序，好让结果可复现，但没有哪个字段依赖这个顺序：context 按被问到的顺序累积，`preventContinuation` 是任意为真即为真，`steer`、一组参数、一份输出都取第一个给出的。唯一能让一个 hook 压过一群的字段是 `decision`，这是刻意的：拒绝绝不能因为别人说好而被稀释。

四条事实界定了这套方言。它点名十二个事件，而更广的 hook 生态点名更多，包括这个版本不带的几十个，新增一个要先在这里加。hook 可以改掉一次调用运行时的参数，也可以改掉模型被告知这次调用返回了什么，而改不了这次调用的其他任何东西。它可以放行、拒绝，或者把问题交给一个人，但不能替那个人作答。而除了落进会话的那条上下文消息之外，hook 不报告它决定了什么，因为决定只在会话里才是持久的。

-----

<a id="further-exploration"></a>
## 进一步探索

- [hooks-native](../hooks-native/README.zh.md)：调用这些 hook 并合并其答案的引擎。
- [agent-core](../../agent/agent-core/README.zh.md)：把结果映射成循环决策的那座桥。
- [hooks 包](README.zh.md)：这份方言所属的组。
- [十二个 hook 点](../../../docs/user/hooks.zh.md)：这十二个事件落在一轮里的哪个位置。