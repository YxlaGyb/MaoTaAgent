# hook 点

[English](hooks.md) | 中文

hook 是一个想在 agent 循环的某个点上说话、又不想让循环知道它存在的插件。本文持有这套安排：十二个点落在一轮里的哪个位置、hook 用什么写、谁在循环与 hook 方言之间做翻译，以及那条让 hook 无法削弱任何东西的不变式。循环引擎不认识 hook：它只开三个 seam 并声明自己消费的决策，一切 hook 形状的东西都待在桥的 hook 那一侧。

## 目录

- [十二个点落在哪](#where-the-twelve-points-sit)
- [方言](#the-dialect)
- [桥](#the-bridge)
- [hook 只能收紧](#hooks-only-tighten)
- [相关文档](#related-documentation)

-----

<a id="where-the-twelve-points-sit"></a>
## 十二个点落在哪

一轮会经过十二个点，名字沿用更宽的 hook 生态的叫法。

| 点 | 什么时候触发 | hook 能做什么 |
|---|---|---|
| `UserPromptSubmit` | 提示词被拼进消息之前，也还没被写下来之前。 | 拒绝这条提示词，或者添加 context。 |
| `SessionStart` | 这次 run 获准开始之后、工具还没被列出之前。 | 添加 context，它会落在第一步之前。 |
| `PreModel` | 每次模型调用之前。 | 添加 context。 |
| `PostModel` | 每次模型调用落定之后。 | 添加 context。 |
| `PreToolUse` | 一次工具调用被派发之前，也被分类之前。 | 拒绝这次调用、替换它的参数，或者添加 context。 |
| `PostToolUse` | 这次调用落定、它的结果还没写回去之前。 | 请求结束这一轮、替换模型被告知它返回了什么，或者添加 context。 |
| `PreCompact` | 一段长历史被折叠之前，且只在真的要折叠时才触发。 | 添加 context。 |
| `SubagentStart` | 一次委派开始、它的第一次模型调用之前。 | 添加 context。 |
| `SubagentStop` | 一次委派结束时，无论它是怎么结束的。 | 添加 context。 |
| `Notification` | 一次 run 因为模型没机会开口的原因停下时。 | 添加 context，好让某个人被告知。 |
| `Stop` | 模型没有要求任何工具调用时，也就是一轮本来要结束的那一刻。 | 在结束之前再说一句，或者添加 context。 |
| `SessionEnd` | 这次 run 结束时，无论它是怎么结束的。 | 添加 context。 |

循环引擎持有工具与收尾那几个点背后的三个 seam。它声明自己消费的决策：`PreToolDecision`（`decision`、`reason`、`args`、`context`）、`PostToolDecision`（`context`、`halt`、`output`）与 `StopDecision`（`context`、`steer`）。被拒的 pre 工具决策既到不了 `classify`，也到不了工具，调用方会被告知理由；post 工具上的 halt 会在请求它的那一批之后结束这一轮；stop 上的 steer 只会让这次 run 再续一次，因为循环记下了自己已经被 steer 过，而 `max_steps` 仍兜着底。于是一轮的结束原因只可能是五种之一：`completed`、`aborted`、`max_steps`、`refused`、`stopped`。

提示词那个点没有自己的 seam，因为循环里没有任何东西作用于一条提示词：`agent-core` 在拼消息之前问 hook。那里的拒绝什么都不写进会话、也不调模型；调用方收到的是一条收尾事件，`steps` 为 0、文本是 hook 给的理由、原因是 `refused`。

循环没有 seam 的那八个点照样被听见。`agent-core` 会把它们贡献的 context 写成这一轮里的一条 `hook:<name>` 消息，位置就是这个点所在的位置，所以在 `SessionStart` 加上的注记会被第一次模型调用读到，而在 `SessionEnd` 加上的注记会被下一轮读到。在那里被消费的只有这一个字段：一个存在的意义是告诉 hook 某件事的点，没法变成对一次它本不参与的调用的改写。

子代理会走到这些点里的每一个，只有两个除外。`UserPromptSubmit` 与 `Stop` 是人这一轮的接缝：子代理没有自己的提示词，也不接受继续指令，所以这两个点对它都不触发。它的调用带父的 `session_id` 与 `call_id`，以及一个指名子代理的 `subagent` 字段，所以读载荷的 hook 单看位置分不出一次子调用与会话自己的调用；会话、模型与折叠这几种点带的是 `subagent: true`。

hook 注入的文本会变成一条名为 `hook:<name>` 的 user 消息，所以读已存会话的人能把它和用户自己打的字区分开。注入的文本随会话落盘，并且落在这一轮里它该在的位置：对提示词那个点，是历史之后、第一步之前；对工具那两个点，是紧跟在它所谈的那次调用的工具结果之后；其余的，就落在那个点本身的位置上。被 steer 出来的续跑带的名字是 `hook:stop`。

<a id="the-dialect"></a>
## 方言

hook 这一侧持有自己的词汇，且只住在一个零依赖包里，好让 hook 作者与引擎共用它，而不必互相 import。

- [`hook-protocol`](../../packages/hooks/hook-protocol/README.zh.md) 持有十二个事件名、各自带的 payload、`HookReply`（一个 hook 写了什么）、`HookOutcome`（多份回复合成什么）、`hook.*` 提供者契约与合并规则。
- [`hooks-native`](../../packages/hooks/hooks-native/README.zh.md) 提供 `agent-core` 调用的 `hooks` 能力：它找出内核公布的每一个 `hook.*` 能力以及 profile 列出的命令 hook，问那些声明过本次事件的，合并它们的答案，给每份贡献盖上它来自哪个 hook，并记一行日志。
- [hooks 包组](../../packages/hooks/README.zh.md) 是这两者合在一起的介绍。

hook 声明 `hook.<name>` 能力，用 `describe` 说出自己实现了哪些事件，并为每个声明的事件实现一个同名方法，参数是该事件的 payload。这个能力就是全部的登记：没有 register 调用、没有拆卸、也没有要跟重载保持同步的状态。hook 也可以是一条命令，由 profile 列出、或由一次 run 为它自己的长度登记；它以 JSON 的形式在 stdin 收到事件，在 stdout 用一个 JSON 对象作答，而它每跑一次都会在 `$MAOTA_HOME/audit/hooks.jsonl` 里留下一行。

合并由严格度决定，而不是由顺序决定。一个拒绝压过任意多个发问与放行，一个发问压过任意多个放行，最后只有胜出那一档的理由活下来，用空行连接。context 按 hook 顺序累积，逐条截断，每一段仍标着写下它的 hook。任意一个 hook 请求过 `preventContinuation` 就是真；steer、一组替换参数、一份替换输出，各自取第一个给出它的 hook。扇出按能力名升序，所以同样的 hook 每次都按同样的顺序作答，而默认情况下，声明过同一个事件的 hook 是同时被问的。

<a id="the-bridge"></a>
## 桥

`agent-core` 是唯一同时认识两套词汇的文件，也是唯一给 hook 字段改名的地方。每个点它调一次 `hooks.trigger`，再把答案映射到循环声明过的决策上，凡是那个 seam 用不上的字段就丢掉。部署里没有别处需要同时懂两边，这正是循环可以不含 hook 名字、hook 包可以不含循环类型的原因。

工具后的拒绝值得单独说一句，因为那个 seam 只有三个字段：那里的拒绝被读成请求结束这一轮，它的理由作为 context 一起带上，好让模型知道为什么。想结束却不说话的 hook 用 `preventContinuation`。

`PreToolUse` 是唯一能问出一个问题的点。答 `ask` 的 hook 会把这次调用交给审批层，而审批层的答案就是决策；拒绝从不会被拿去再问一次，而没人可问的 `ask` 就是一次拒绝，因为一个问题绝不能悄悄变成一次同意。

桥也是把提示词拒绝变成收尾事件的地方，所以前端看到的形状与别的 `done` 事件一样：`steps` 为 0，什么都没写下来。桥还是把其余每一个点贡献的 context 写进这一轮的地方，所以循环不必为一个没有决策可消费的点专门开一条 seam。

<a id="hooks-only-tighten"></a>
## hook 只能收紧

hook 可以拒绝；它永远不能把一次调用从任何东西里豁免出去。

- `PreToolUse` 在分类之前跑，所以被拒的调用既不被分类也不被派发。hook 放行的调用照旧被原样分类，工具该问自己的审批还是照问。
- `UserPromptSubmit` 在提示词被存下之前跑，所以一次拒绝不可能被记录、也不可能到得了模型。
- `PostToolUse` 与 `Stop` 能结束一轮，但不能在循环允许自己的那一次 steer 之外再加一步。
- 坏掉的 hook 是没有意见，而不是一票否决或一票放行：抛错的、连不上的、超时的 hook 会被记一条日志后跳过，底下的几层照旧自己决定。那几层本来就是 fail closed 的，这正是这里可以宽容的原因。

内核里没有任何东西检查一个 hook：hook 就是引擎照常路由的能力，没有挂 hook 的部署与整个特性不存在的表现完全一致。hook 只在上面那十二个点上起作用，别处不起：没有对任意调用的内核层拦截，更宽生态点名的另外二十来个事件这个版本也不带。

<a id="related-documentation"></a>
## 相关文档

- [hooks 包组](../../packages/hooks/README.zh.md)：那两个包以及它们怎么被挂载。
- [hook-protocol](../../packages/hooks/hook-protocol/README.zh.md)：事件、payload、提供者契约与合并规则。
- [hooks-native](../../packages/hooks/hooks-native/README.zh.md)：引擎、它的方法与配置。
- [agent-loop](../../packages/agent/agent-loop/README.zh.md)：接缝与结束原因。
- [审批闸门](permission.zh.md)：决定一次操作到底跑不跑的那一层。
- [架构](../architecture.zh.md)：hook 在整个系统里的位置。