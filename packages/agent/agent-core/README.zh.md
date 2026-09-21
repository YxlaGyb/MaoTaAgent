---
description: "面向插件、UI 与编排器的 Agent 句柄、实时注册表、进程本地发起方作用域，以及 agent/* 事件词汇。"
kind: "package-reference"
---

# agent

[English](README.md) | 中文

## 概述

`agent` 是前端真正对话的那个插件。一次 `run` 调用先从 `session` 取出历史，在前面拼上由基础提示词、工作目录与可用技能构成的系统提示词，跑完模型与工具的循环，再把这一轮写回去。它提供 `agent.loop@1.2.0`，方法有 `run` 与 `info`。循环本身在 [`../agent-loop`](../agent-loop/README.zh.md)；本目录负责它周边的配置、提示词、会话记账与工具装配，挂上引擎时它也是循环与 hook 之间的桥。profile 配置拉起的是这个包：由 [`src/index.ts`](src/index.ts) 构建出的 `lib/index.js`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

前端通过 `agent.loop` 能力找到这个插件。

### 方法

| 方法 | 回答 |
|---|---|
| `run` | 一条流。它要求 `meta.stream`，不带这个元信息的调用会被拒绝。 |
| `info` | `{ levels, thinking }`：支持的思考档位，以及已配置的表。 |

### `run` 的输入

| 输入 | 含义 |
|---|---|
| `session_id` | 这一轮属于哪段已存会话。缺省是 `default`。 |
| `cwd` | 会话的工作目录。缺失或为空表示这段会话没有工作目录。 |
| `input` | 用户的消息。空串表示就按已存历史跑一轮。 |
| `thinking` | 档位：`off`、`low`、`medium`、`high`。缺省是 `off`。 |

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_steps` | `8` | 一轮最多发起几次模型调用。 |
| `max_parallel_tools` | `4` | 一个批次里最多同时跑几个安全工具调用。 |
| `system` | 随包提供的编码助手提示词 | 基础系统提示词。 |
| `thinking` | `{}` | 每个档位的 `model` 与 `tools`。档位可以只写模型名，也可以写成表。 |

未知的档位名会在调用 `run` 时以 `-32602` 拒绝；`plugins.agent-core.config` 里多余的键由 `pnpm check:config` 点名。

### 事件

`run` 会把循环自己的事件、每 10 秒一条 `tick`，以及收尾的 `done` 推出去。

| 事件 | 载荷 | 含义 |
|---|---|---|
| `tick` | 无 | 这一轮还活着。 |
| `done` | `{ steps, text, reason }` | 这一轮结束了。`reason` 取 `completed`、`aborted`、`max_steps`、`refused` 或 `stopped`；`refused` 是本插件自己拒绝了提示词，此时 `steps` 为 0。 |

### 工具

`skill` 在场时，它的技能会进系统提示词，并多提供一个 `skill` 工具。其余工具都来自 `tools`。声明了宿主参数的工具会在调用之前拿到那个值，除非模型自己给了这个参数。来源共三种：`session_cwd`、`session_id` 与 `call_id`，于是工具知道自己在服务哪段会话、正在跑哪次调用，而模型冒充不了其中任何一个；这些参数都会从交给模型看的 spec 里剥掉。安全与否经 `tools.classify` 询问，`skill` 工具自己答安全。

`permission` 能力在场时，每轮读一次它给这段会话的策略并写进系统提示词，好让模型知道"被拒绝"是什么意思，而不是反复重试一条没人会批准的命令。没有这个能力时提示词对审批只字不提，而那些本该发问的工具会把这份缺席读成"会问"的那一档。

### Hook

`hooks` 能力在场时，一轮里有四个点交给 hook：组装消息之前的 `UserPromptSubmit`，以及循环的三条接缝 `PreToolUse`（调用被分类之前）、`PostToolUse`（一次调用落定之后）与 `Stop`（模型不再要求任何工具调用时）。本文件是唯一同时认识两套词汇的地方：它每个点调用一次 `hooks.trigger`，把回答映射成循环声明过的决策，所以循环听不到 hook 的名字，hook 包也看不到循环的类型。被拒绝的提示词是唯一什么都不写、不调模型、直接以 `done` 收尾并报出 `refused`（`steps` 为 0）的路径。这个能力是可选的：没有引擎的部署就等于没有 hook，起跑时记一行日志。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 定义：配置、`requires`、`run`、`info`、hook 桥与 `selfCheck` |
| [`src/prompt.ts`](src/prompt.ts) | `systemPrompt`：基础提示词、工作目录与技能清单 |
| [`src/tools.ts`](src/tools.ts) | `skill` 工具的规格、`readToolList`、`stripHostArgs` 与 `injectHostArgs` |

### 一轮的过程

`run` 先列出工具与技能，取回已存会话，把新输入追加进去（非空时），并在第一次模型调用之前就把这份历史存下去，所以中途死掉的一轮也会在会话里留下记录。接着它拼出一个消息数组，系统提示词在最前、历史在后，然后跑循环。循环返回后，去掉系统提示词的同一份数组会连同这一轮的标题再存一次。

在读取会话之前，提示词就先交给 hook 过一遍，那里被拒绝时这一轮什么都不存，也不调模型。hook 贡献的文本会以 `name` 为 `hook:<name>` 的 user 消息进入数组：提示词的排在历史之后、第一步之前，工具点的紧跟在它所对应的结果之后。

取消请求会中止正在进行的模型调用与工具调用，会话保留已经追加的部分。除循环自身的事件外，这个插件只多推一样东西：一轮运行期间每 10 秒一条 `tick`。

### 配置检查

`selfCheck` 覆盖本目录的纯函数部分：档位读取、标题截断、宿主参数的注入与剥离、`readToolList`，以及两次脚本化运行，一次必须以 `completed` 结束，一次必须以 `max_steps` 结束。hook 桥也在那里被检查：三个映射各自只留下对应接缝用得上的字段、空回答算没有意见、post 工具拒绝会结束本轮并带上理由，引擎缺席或调用失败都返回空回答。任何一处走样都会让 `--check` 失败，所以 `pnpm check:plugins` 不用内核、不用模型就能抓到。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-loop](../agent-loop/README.zh.md)：这个插件跑的循环引擎。
- [agent 包](../README.zh.md)：插件与循环怎么分工。
- [packages 包组](../../README.zh.md)：插件树，以及哪个插件持有哪个能力。
- [maota CLI](../../../apps/cli/README.zh.md)：驱动 `agent.loop` 的前端。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **它从不挑模型**：档位给的是一个名字，模型映射由网关持有。
- **没有上下文压缩**：长会话每一轮都整份重放。
- **没有失败分类**：模型调用被拒就以流错误结束这一轮，不会重试。
- **`max_steps` 是硬停**：消息留着，这一轮只是报出 `max_steps`。
- **hook 改不了调用的内容**：hook 只能拒绝调用、往这一轮里加文本，永远不能改写工具的入参或输出。
- **一轮在开始前就已存盘**：被打断的一轮会在会话里留下末尾那条用户消息。
