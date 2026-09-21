# 四个 hook 点

[English](hooks.md) | 中文

hook 是一个想在 agent 循环的某个点上说话、又不想让循环知道它存在的插件。本文持有这套安排：四个点落在一轮里的哪个位置、hook 用什么写、谁在循环与 hook 方言之间做翻译，以及那条让 hook 无法削弱任何东西的不变式。循环引擎不认识 hook：它只开三个 seam 并声明自己消费的决策，一切 hook 形状的东西都待在桥的 hook 那一侧。

## 目录

- [四个点落在哪](#where-the-four-points-sit)
- [方言](#the-dialect)
- [那座桥](#the-bridge)
- [hook 只能收紧](#hooks-only-tighten)
- [本文不覆盖的部分](#what-this-does-not-cover)
- [相关文档](#related-documentation)

-----

<a id="where-the-four-points-sit"></a>
## 四个点落在哪

一轮会经过四个点，名字沿用更宽的 hook 生态的叫法。

| 点 | 什么时候触发 | hook 能做什么 |
|---|---|---|
| `UserPromptSubmit` | 提示词被组装成消息之前，也还没被写下来之前。 | 拒绝这条提示词，或者补充 context。 |
| `PreToolUse` | 一次工具调用被派发之前，也被分类之前。 | 拒绝这次调用，或者补充 context。 |
| `PostToolUse` | 这次调用已经落定、结果还没写回去之前。 | 请求结束这一轮，或者补充 context。 |
| `Stop` | 模型没有要求任何工具调用时，也就是这一轮本来要结束的那一刻。 | 在它结束之前再说一句，或者补充 context。 |

循环引擎持有这些点背后的三个 seam，并声明自己消费的决策：`PreToolDecision`（`decision`、`reason`、`context`）、`PostToolDecision`（`context`、`halt`）与 `StopDecision`（`context`、`steer`）。被拒的工具前决策既到不了 `classify` 也到不了工具，并且会告诉调用方原因；工具后的 halt 会在提出它的那一批结束后收尾；Stop 的 steer 恰好让这一轮继续一次，因为循环记下了自己已经被 steer 过，而 `max_steps` 仍是最终兜底。于是一轮的结束原因有五种：`completed`、`aborted`、`max_steps`、`refused` 与 `stopped`。

提示词那个点没有自己的 seam，因为循环里没有任何东西适用于一条提示词：`agent-core` 在组装消息之前去问 hook。在那里被拒时，会话里什么都不写、模型也不被调用；调用方收到一个收尾事件，`steps` 为 0，文本是 hook 给出的理由，原因是 `refused`。

hook 注入的文本会变成一条名为 `hook:<name>` 的 user 消息，所以读已存会话的人能把它和用户自己打的字区分开。注入的文本随会话落盘，并且落在这一轮里它该在的位置：对提示词那个点，是历史之后、第一步之前；对工具那两个点，是紧跟在它所谈的那次调用的工具结果之后。被 steer 出来的续跑带的名字是 `hook:stop`。

<a id="the-dialect"></a>
## 方言

hook 这一侧持有自己的词汇，而它住在一个零依赖的包里，于是 hook 作者和引擎都能共享它，谁也不用 import 对方。

- [`hook-protocol`](../packages/hooks/hook-protocol/README.zh.md) 持有四个事件名、各自带的 payload、`HookReply`（一个 hook 写了什么）、`HookOutcome`（多份回复合成什么）、`hook.*` 提供者契约与合并规则。
- [`hooks-native`](../packages/hooks/hooks-native/README.zh.md) 提供 `agent-core` 调用的 `hooks` 能力：它发现内核公布出来的 `hook.*` 能力、只问声明过本次事件的那些、合并它们的答案、给每份贡献盖上它来自哪个 hook，最后记一行日志。
- [hooks 包组](../packages/hooks/README.zh.md) 是这两者合在一起的介绍。

hook 声明 `hook.<name>` 能力，用 `describe` 说出自己实现了哪些事件，并为每个声明的事件实现一个同名方法，参数就是该事件的 payload。这个能力就是全部登记手续：没有注册调用、没有拆卸流程，也没有要跟重载保持一致的状态。

合并由严格度决定，而不是顺序。一个拒绝压过任意多个放行，并且只有拒绝那一档的理由活下来，用空行连接。context 按 hook 顺序累积、逐条截断，每一段仍带着写下它的那个 hook 的名字。任意一个 hook 请求过 `preventContinuation` 即为真，`steer` 取第一个给出的。扇出本身按能力名升序，所以同一批 hook 每次都以同样的顺序作答。

<a id="the-bridge"></a>
## 那座桥

`agent-core` 是唯一同时认识两套词汇的文件，也是唯一给 hook 字段改名的地方。每个点它调一次 `hooks.trigger`，再把答案映射到循环声明过的决策上，凡是那个 seam 用不上的字段就丢掉。部署里没有别处需要同时懂两边，这正是循环可以不含 hook 名字、hook 包可以不含循环类型的原因。

工具后的拒绝值得单独说一句，因为那个 seam 只有两个字段：那里的拒绝被读成请求结束这一轮，它的理由作为 context 一起带上，好让模型知道为什么。想结束却不说话的 hook 用 `preventContinuation`。

提示词的拒绝也是在这座桥里变成一个收尾事件的，所以前端看到的形状和任何一次收尾一样：一个 `done` 事件，`steps` 为 0，什么都没写下来。

<a id="hooks-only-tighten"></a>
## hook 只能收紧

hook 可以拒绝，但永远无法豁免任何东西。

- `PreToolUse` 跑在分类之前，所以被拒的调用既不被分类也不被派发。被 hook 放行的调用照旧被分类，该问审批的工具也照旧去问。
- `UserPromptSubmit` 跑在提示词被存下之前，所以拒绝既不会被记录，也到不了模型。
- `PostToolUse` 与 `Stop` 可以结束一轮，但无法在循环允许自己的那一次 steer 之外再往前多走一步。
- 坏掉的 hook 是没有意见，而不是一票否决或一张通行证：抛错的、连不上的、超时的 hook 记一条日志后被跳过，下面那几层照旧决定。那几层本来就是 fail closed 的，这正是这里可以宽容的原因。

内核里没有任何东西检查 hook：hook 就是引擎像其他能力一样路由的能力，而没挂 hook 的部署，其行为和一个没有这个特性的部署完全一样。

<a id="what-this-does-not-cover"></a>
## 本文不覆盖的部分

- 没有命令式 hook，也没有通往 `hooks.json` 的桥：hook 是带能力的插件，外部命令行在这一版里不算 hook。
- 没有 `ask` 档决策：hook 只放行或拒绝，从不把问题交给一个人。审批闸门仍是唯一会发问的东西。
- 不改写输入输出：hook 决定一次调用跑不跑，从不决定它用什么跑、或者返回什么。
- 没有持久的 hook 审计：hook 的决定是一行日志，以及它注入 context 时落进会话的那条消息。没有单独的 hook 日志可供回读。
- 只有四个事件，不是更宽生态里的二十来个，也没有内核层的通用拦截：hook 只在上面的点起作用，别处不起。

<a id="related-documentation"></a>
## 相关文档

- [hooks 包组](../packages/hooks/README.zh.md)：那两个包以及它们怎么被挂载。
- [hook-protocol](../packages/hooks/hook-protocol/README.zh.md)：四个事件、payload、提供者契约与合并规则。
- [hooks-native](../packages/hooks/hooks-native/README.zh.md)：引擎、它的方法与它的配置。
- [agent-loop](../packages/agent/agent-loop/README.zh.md)：那几个 seam 与退出原因。
- [权限闸门](permission.zh.md)：决定一次操作到底跑不跑的那一层。
- [架构](architecture.zh.md)：这些 hook 坐落在整个系统的哪里。
