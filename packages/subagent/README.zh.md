---
description: "subagent 组：把一件子任务交给一个自带上下文的代理的那个工具，以及让它的所作所为留在发起它的那次调用之下的那些接缝。"
kind: "package-group"
---

# subagent/: 委派

[English](README.md) | 中文

## 概述

大任务切成互不共享上下文的几块之后更好读。这个组里装着做这件事的工具：[`tool-subagent`](tool-subagent/README.zh.md) 声明 `tool.task` 能力，`tools` 分派器以 `task` 之名把它提供给模型。一次调用交出一件子任务，只收回一条最终消息；其余一切都留在子代理自己的会话里。子运行属于 `agent-core`，子代理的记录属于 `session`，它调用对外带的身份属于 `permission` 与钩子。

## 目录

- [模块](#modules)
- [一次委派的全程](#one-delegation-end-to-end)
- [子代理做不到的事](#what-a-subagent-cannot-do)
- [进一步探索](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`tool-subagent`](tool-subagent/README.zh.md) | 委派的模型侧：`task` 能力、它的两种子代理、每种拿到的工具面、并发上限，以及答案的三种形态。 |

`tool-subagent` 和别的工具一样被发现：内核公布它的能力，`tools` 分派器把找到的列出来，`agent-core` 注入会话 id、工作目录与这次调用的 id 作为宿主参数。这份 profile 配置拉起的包是 `@maota/tool-subagent`，由 `tool-subagent/src/index.ts` 构建。

工具本身不持有模型、不碰文件。它唯一声明的依赖是 `agent.loop` 的 `^1.3`，因为子运行正是在那里产生的。

<a id="one-delegation-end-to-end"></a>
## 一次委派的全程

1. 模型调用 `task`，带上 `prompt`、一个短标签 `description` 和 `subagent_type`。
2. `tool-subagent` 在已在跑的子代理过多时拒绝这次调用；否则生成一个子会话 id，向 `agent.loop` 要一次子运行：全新的 `messages[]`、子代理自己的系统提示词、过滤过的工具清单、它自己的步数上限，以及一个写明父会话与这次调用的 `origin`。
3. 子运行从空历史开始，永远拿不到会再次委派的那个工具，并在运行中发布 `agent.subagent.*` 事件。
4. 它停下时，把自己的对话写进会话存储，连同那条能让界面挂到正确调用之下的父链。
5. 调用方拿到的，是子代理最后那条消息（作为 `task` 调用的结果）、一次拒绝，或一份标明是「部分」的答案。

这次运行的其它一切都被刻意留在原地。子代理是把上下文花在别处的方式，不是向父会话写入的方式。

<a id="what-a-subagent-cannot-do"></a>
## 子代理做不到的事

- **不能再次委派。** 无论部署在 `child_tools_deny` 里写什么，`task` 对每个子代理都是拒绝项；幻觉出来的一次调用会像其它不在工具面内的工具一样，在 pre-tool 接缝被拒。
- **看不到父会话的对话。** 它的上下文只有自己的系统提示词和交给它的那一条 prompt。
- **够不到技能清单。** 子代理不会被提供 `skill` 工具，提示词因此保持很小。
- **在父会话历史里活不过这次调用。** 只有它最后那条消息回来，而且只是一条工具结果。

<a id="related-documentation"></a>
## 进一步探索

- [tool-subagent](tool-subagent/README.zh.md)：工具本身、它的配置、拒绝与结果形态。
- [子代理](../../docs/user/subagent.zh.md)：整条接缝，含子运行、父链与事件。
- [agent-core](../agent/agent-core/README.zh.md)：跑子运行并持有运行参数的包。
- [session](../session/README.zh.md)：子代理写入的那份文档，以及其中的父链。
- [架构](../../docs/architecture.zh.md)：组件表与启动路径。
