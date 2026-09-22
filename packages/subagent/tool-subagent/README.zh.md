---
description: "subagent 工具：模型交给一个自带上下文的代理的那件任务、它可以要的两种子代理、每种拿到的工具面、同时在跑的数量上限，以及答案的三种形态。"
kind: "package-reference"
---

# tool-subagent

[English](README.md) | 中文

## 概述

一个能力，`tool.task`，以 `task` 之名提供给模型。一次调用把一件自成一体的工作交给一个子代理，只收回一条最终消息：子代理拿到全新的上下文、自己的工具和自己的步数上限，而这次运行的其余部分都留在调用方的历史之外。并发是 `always`，所以同一步里的多个 `task` 调用可以并排跑，上限由本插件自己把住。工具不声明 `maxResultChars`，于是过长的答案会和别的长结果一样，由 `tools` 分派器落到文件里。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### `task`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `prompt` | string | 是 | 整件子任务：目标、从哪儿开始、要交回什么。子代理没见过这段对话，凡它需要的都得写在这里。 |
| `description` | string | 是 | 这件子任务的短标签。它成为子会话的标题，也是界面显示在这次调用旁边的文字。 |
| `subagent_type` | string | 否 | `general` 或 `explore`；不写就是 `general`。 |
| `session_id` | string | 宿主 | 这次调用所属的会话。由宿主注入，从不公开。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |
| `call_id` | string | 宿主 | 这次调用的 id，好让子代理的所作所为显示在它下面。由宿主注入，从不公开。 |

| `subagent_type` | 它能用的工具 | 系统提示词 |
|---|---|---|
| `general` | 工具池里的全部，减去 `task`，再减去 `child_tools_deny`。 | `general_system` |
| `explore` | 只有 `explore_tools`，同样减去那些拒绝项。 | `explore_system` |

两种都不给 `skill` 工具：子代理的提示词保持很小，它也不是来把提示词撑大的。

### 回什么

一个字符串，三种形态之一。

| 形态 | 何时 |
|---|---|
| 子代理最后那条消息，去掉首尾空白 | 子运行以 `completed` 结束。 |
| 那条消息，后面再加一段说明它到了步数上限 | 子运行以 `max_steps` 结束。子代理毕竟干了活，所以这份答案作为「一部分」交出。 |
| `the subagent finished without a final message` | 子运行结束却一个字都没有。 |

其余情况都变成抛出的错误，由循环写成失败的工具结果：撞上限、子代理出错，以及子代理被取消。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_concurrent` | `4` | 本进程同时在跑的子代理上限。 |
| `child_max_steps` | `8` | 交给每次子运行的步数上限。 |
| `child_tools_deny` | `[]` | 任何子代理都不许用的工具名。`task` 永远在拒绝名单里，且无法被移除。 |
| `explore_tools` | `["read", "glob", "grep"]` | `explore` 子代理可以用的工具。 |
| `general_system` | 包内自带的提示词 | `general` 子代理运行时的系统提示词。 |
| `explore_system` | 包内自带的提示词 | `explore` 子代理运行时的系统提示词。 |

### 拒绝

| 拒绝 | 错误码 | 何时 |
|---|---|---|
| `prompt must be a non-empty string` | `-32602` | prompt 缺失、不是字符串或全空白。 |
| `description must be a non-empty string` | `-32602` | 标签缺失、不是字符串或全空白。 |
| `subagent_type must be one of general, explore, got …` | `-32602` | 类型不是那两种之一。 |
| `N subagents are already running, which is the cap, so this call was refused before it started: wait for one of them to finish, or do the work here instead, and do not retry it right away` | `-32019` | 到达上限。这段话是说给模型听的：立刻重试只会再撞一次。 |
| `the <type> subagent failed before it answered: …` | `-32603` | 子运行抛错，或结束时没有结果。 |
| `the <type> subagent was cancelled` | `-32013` | 子运行期间父轮次被取消。 |

上限数的是在跑的子代理，所以被拒绝的调用不会启动任何一个，而跑完一个就立刻腾出座位。计数放在本插件里，因为只有本插件知道哪些调用是子代理：循环只知道某个工具声明了 `concurrency: always`。

------

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、配置、并发闸门、子运行与 `selfCheck`。 |
| [`src/task.ts`](src/task.ts) | `readSubagentType`、`childPlan`、`childId`、两份自带提示词与几句文案的构造。 |

### 一次调用

`run` 读三个参数，撞上限就拒绝，然后生成子会话 id：`sub-` 加十二位十六进制。接着它以流式向 `agent.loop` 要一次运行：子代理自己的会话 id 与工作目录、写明父会话与这次调用的 `origin`、计划里的 `system`、`tools_allow`、`tools_deny`，以及以 `child_max_steps` 作为 `max_steps`。流被读到结尾，最后那个 `done` 事件就是答案。

座位是在要子运行之前占的，并在 `finally` 里释放，所以抛错的、被取消的、被循环拒绝的子代理都会让出座位。

### 子代理的工具面为什么是两道过滤，而不是一道

子代理拿到的工具面由 `agent-core` 执行，不在本插件里：本插件只交出 `tools_allow` 与 `tools_deny`。这是有意的：只把工具从清单里藏起来的过滤，仍会放过幻觉出来的调用，所以子运行还会在 pre-tool 接缝再判一次，把工具面之外的调用答成被拦的结果。本包负责计划，而计划里永远有 `task`。

### 为什么 `concurrency` 是 `always`、为什么没有 `maxResultChars`

一步里两个 `task` 调用正是这个工具的意义，而循环本来就会把一步里所有 `always` 工具按 `max_parallel_tools` 分批，所以并排跑不需要改循环里任何东西。上限放在本插件的 `max_concurrent`，因为只有本插件看得见全局。

`task` 的结果是对别人工作的摘要，可能很长。与其在这里裁掉，工具干脆不设上限，让 `tools` 分派器自己的 spill 把过大的结果写进文件，再把路径交给模型。

------

<a id="further-exploration"></a>
## 进一步探索

- [subagent 组](../README.zh.md)：本工具所属的组。
- [子代理](../../../docs/user/subagent.zh.md)：子运行、父链、事件，以及子代理调用对外带的身份。
- [agent-core](../../agent/agent-core/README.zh.md)：跑子运行并执行其工具面的包。
- [tools](../../agent/tools/README.zh.md)：列出本能力、注入宿主参数并溢出过长结果的分派器。

------

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **永远只有一层**：子代理不能再委派。深度没有任何可配置的地方。
- **不能续聊，也不能后台跑**：调用方等子代理结束，而子会话 id 不会交回，所以后面的轮次无法接着那段对话。
- **没有 agent 定义文件**：子代理的提示词来自本插件的配置，而不是每个 agent 一个文件。
- **不 fork 父会话**：每个子代理都从空开始。需要父上下文的子代理，只能在 `prompt` 里拿到。
- **没有结构化输出**：答案就是文本。想要形状的调用方得用文字把形状说清楚。
- **没有自己的超时**：子代理的边界只有 `child_max_steps` 和父轮次的取消，再没有别的。
- **上限是按进程算的**：两个共用同一内核的前端共用一份预算，这是「在跑」最诚实的读法，但也就意味着部署无法按会话预留座位。
