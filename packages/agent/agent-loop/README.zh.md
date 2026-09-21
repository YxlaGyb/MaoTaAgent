---
description: "面向用户与维护者的默认 agent（智能体）驱动器说明，用于选择、配置或调试 agent 的创建方式以及轮次与步骤的运行方式。"
kind: "package-reference"
---

# agent-loop

[English](README.md) | 中文

## 概述

一轮对话跑在其上的循环引擎：调用模型、执行它要求的工具、把结果喂回去，如此往复。它不读配置、不碰会话，也不认识网关，因为 [`../agent-core`](../agent-core/README.zh.md) 把这两样都做成了接缝。每次运行都以一个原因收尾：`completed`、`aborted`、`max_steps` 或 `stopped`，驱动这次运行的插件还可能为一个从未发出的提示词报出 `refused`。三条可选接缝与那个插件分担这一轮：`classify` 之前的 `preTool`、一次调用落定之后的 `postTool`，以及模型不再要求任何东西时的 `atStop`。工具轮会把连续答“安全”的调用编成一个批次，批次上限 `max_parallel`，其余调用各自单独跑。这个模块有五个文件、一个导出的入口 `runLoop`，而且只发它正在跑的那一轮的事件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

导入桶文件，把几条接缝交给 `runLoop`，然后读结果。

```ts
const outcome = await runLoop(deps, messages, signal, emit);
```

### 依赖

| 字段 | 含义 |
|---|---|
| `tools` | 提供给模型的工具规格。 |
| `max_steps` | 一次运行最多发起几次模型调用。 |
| `max_parallel` | 一个批次里最多同时跑几个调用。不写或写得不对都算 1，也就是一次一个。 |
| `classify(call, ctx)` | 这次调用能否与别的并排跑。缺这条接缝、答的不是严格 `true`、或者抛错，都算不能。 |
| `callTool(call, ctx)` | 一次工具调用。抛错就表示这个工具失败了。 |
| `preTool(call, ctx)` | 跑在 `classify` 之前：它拒绝时，这次调用既不被分类也不被派发。它放行不等于放行任何东西，因为 `classify` 和工具自己的审批照旧执行。 |
| `postTool(call, outcome, ctx)` | 在那次调用落定之后、接缝贡献的文本写回去之前跑。它可以结束这次运行，也可以往对话里加文本。 |
| `atStop(state, ctx)` | 只在模型没有要求任何工具调用时跑，也就是这次运行本来要结束的那一刻。它可以加文本，也可以请求再来一步。 |

### 单步上下文

每条接缝都会收到一个 `StepContext`。

| 成员 | 含义 |
|---|---|
| `state` | `{ messages, step, maxSteps, lastReason, stopSteered, haltRequested }`。`state.messages` 是一次运行中消息的唯一真相。 |
| `tools` | 同一份规格，给单步中途需要它的接缝用。 |
| `step` | 当前的模型调用序号，从 1 开始。 |
| `signal` | 调用方取消这一轮时变为 aborted。 |
| `emit(event)` | 推一条循环事件。 |
| `delta(chunk)` | 推流式模型文本，循环把它变成 `text` 与 `reasoning` 事件。 |

### 结果

| 字段 | 含义 |
|---|---|
| `steps` | 已发起的模型调用数。 |
| `text` | 最后的助手文本，没有时为空。 |
| `reason` | `completed`、`aborted`、`max_steps`、`refused` 或 `stopped`。后两个是调用方自己的拒绝，由驱动这个循环的插件报出；循环自己只会以 `completed`、`aborted`、`max_steps` 或 `stopped` 收尾。 |

### 事件

| 事件 | 载荷 | 含义 |
|---|---|---|
| `step` | `{ step }` | 一次模型调用即将开始。 |
| `text` | `{ text }` | 流式回答文本。 |
| `reasoning` | `{ text }` | 流式推理文本。 |
| `tool_call` | `{ id, tool, args }` | 一个工具即将执行。 |
| `tool_result` | `{ id, tool, ok, output }` | 一个工具执行完了。`id` 是它回应的那次调用。 |

`tick` 与 `done` 属于调用这个循环的插件，不属于循环本身。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/loop.ts`](src/loop.ts) | `runLoop`：步进循环，也是唯一判定退出原因的地方 |
| [`src/execute.ts`](src/execute.ts) | 工具执行接缝：pre 工具决策、分类、分批，以及按顺序走完一轮 |
| [`src/events.ts`](src/events.ts) | `LoopExitReason`、`LoopEvent`、`LoopState`、`StepContext`、`LoopDeps`、`PreToolDecision`、`PostToolDecision`、`StopDecision` 与 `LoopOutcome` |
| [`src/messages.ts`](src/messages.ts) | `Message`、`ToolSpec`、`ToolCall`、`toolCalls`、`parseArgs` 与 `asText` |
| [`src/index.ts`](src/index.ts) | 再导出 |

### 步进循环

只要助手消息里带工具调用，循环就继续；它从不读取 `stop_reason`，因为流式回答可能在那个字段落定之前就已经带上了工具调用。每一步先发 `step`，调用 `chat`，再追加助手消息。一条不带工具调用的消息就是这次运行本来要结束的那一刻，所以循环先问一次 stop 接缝：它贡献的文本会被追加，它请求的 steer 恰好换来一步，之后才以 `completed` 收尾。循环会记下自己已经 steer 过一次，所以一个总是要求再来一步的接缝无法让运行一直活着，`max_steps` 仍然是最后的兜底。否则把调用交给 `execute.ts`；post 工具决策要求 halt 时以 `stopped` 收尾；信号在每一步之前和每个工具轮之后都会再查一次，两种情况停下来都报 `aborted`。

### 工具轮

`execute.ts` 是一轮调用的唯一执行处。它先按调用顺序对每个调用问一次 `preTool`，被拒绝的调用既不被分类也不被派发。没有被拒绝的调用随后去问 `classify`，由它的回答决定分组：连续答严格 `true` 的调用编成一个批次，上限 `max_parallel`；没有这样答的调用，以及每一个被拒绝的调用，各自成一个批次。批次之间严格按顺序，只有批次内部的调用才可能重叠，这正是让一个不安全的调用无法与任何东西并排跑的原因。一个批次开始前，其中每个调用都发 `tool_call`；每个调用落定时发出带 `id` 的 `tool_result`，所以结果的到达顺序可能和调用发出的顺序不同。批次落定之后，按最初的调用顺序为每个调用补写一条 `role: "tool"` 消息，并把调用 id 填进 `tool_call_id`。被拒绝的调用与抛错的工具以同样的方式落定：`ok: false` 加上 `{ error }` 内容，所以模型会知道原因，本轮也会继续。批次写回之后，循环再按顺序对每个落定的调用问一次 `postTool`：两条接缝收集到的文本会按来源各写成一条 user 消息，紧跟在它对应的结果之后；它要求的 halt 会让本轮在那批之后结束。信号中止时，剩下的批次不再开始，已经跑完的调用保留它们的消息。

换一种策略，例如模型还在流式输出时就开始执行，只需替换这个文件。`loop.ts` 不依赖该策略。

### 消息解析

`toolCalls` 从助手消息里读出调用：`tool_calls` 缺失或不是数组都算没有，没有函数名的调用被丢掉，没有 id 的调用变成 `call_<index>`。参数是以 JSON 字符串到达的，所以解析失败时 `parseArgs` 退化成 `{ raw }`，为空时退化成 `{}`。

### 配置检查

`agent-core` 里的 `selfCheck` 用脚本化的接缝驱动这个模块。仓库在它旁边还留了一份测试 [`tests/loop.smoke.ts`](tests/loop.smoke.ts)，覆盖正常结束、一次两个调用的工具轮、抛错的工具、预算用尽、第一步之前就中止、工具轮中途中止、畸形的助手消息、分批与批次上限、不安全调用把一轮切开、结果乱序到达、被拒绝的调用既不被分类也不被派发却仍留下一条 `{ error }` 结果、注入文本落在对应结果之后、halt 以 `stopped` 收尾、steer 只续跑一次、被取消的运行和到达步数上限的运行都不会走到 stop 接缝，以及缺 `classify`、缺某条生命周期接缝或它们抛错。它不需要内核，也不联网，`pnpm loop:smoke` 可以单独跑它。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-core](../agent-core/README.zh.md)：提供模型接缝与工具接缝的插件。
- [agent 包](../README.zh.md)：插件与这个引擎怎么分工。
- [packages 包组](../../README.zh.md)：这个模块所属的插件树。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **分批只看连续段**：一个不安全的调用会把这一轮切开，所以它两侧的安全调用永远不会同批。
- **模型还在流式输出时什么都不启动**：一轮会等助手消息先结束。
- **没有失败分类，也没有重试**：模型调用被拒是调用方的事，循环自己从不重来一次。
- **没有上下文压缩**：消息数组一直长下去，直到调用方不再传回来。
- **循环什么都不持久化**：保存一轮属于插件，每一个配置值也一样。
- **`steps` 统计已发起的调用**：在某一轮中途被中止的运行，报出的就是这个序号。
