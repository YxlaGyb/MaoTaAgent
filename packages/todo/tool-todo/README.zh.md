---
description: "todo 工具：模型为一个会话写下的任务清单、它接受的单项形状、它据以拒绝的上下限，以及清单做完时它加上的验证提醒。"
kind: "package-reference"
---

# tool-todo

[English](README.md) | 中文

## 概述

一个能力，`tool.todo_write`，以 `todo_write` 之名提供给模型。模型按顺序把整份任务清单交给它，每次调用都替换掉上一份清单。工具不持有任何状态：它检查各项、拒绝一份它信不过的清单、通过 `session` 能力把清单写进会话文档，再用一行计数作答。当清单够长且每一项都做完时，这行答案还会带上一段验证提醒。并发是 `never`：两个写入者抢同一份计划，最后一次写入就成了抛硬币。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### `todo_write`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `todos` | array | 是 | 整份任务清单，按顺序。每次调用都替换上一份清单。 |
| `session_id` | string | 宿主 | 这份清单所属的会话。由宿主注入，从不公开。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

每一项是一个只有两个字段的对象。

| 字段 | 类型 | 含义 |
|---|---|---|
| `content` | string | 这一步，按模型希望读回来的样子写。不能全空白，且不超过 `max_content_chars`。 |
| `status` | string | `pending`、`in_progress` 或 `completed`。 |

结果：一行文字，`plan updated: N tasks, P pending, I in progress, C completed (revision R)`；当提醒成立时，后面再跟一小段。清单本身不会回显：模型刚在调用里写过它，而它已经留在会话里，供后面的轮次使用。

写一个空清单就是清除计划。没有单独的清除动作，revision 照常前进，所以清空后的计划和别的计划一样，都是一次写入。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_items` | `64` | 一次调用最多带多少项。 |
| `max_content_chars` | `400` | 单项内容的上限。 |
| `verify_nudge` | `true` | 是否还会加上验证提醒。 |
| `verify_min_items` | `3` | 最少多少项才可能触发提醒。 |

### 验证提醒

当清单至少有 `verify_min_items` 项、且每一项都是 `completed` 时，提醒会加上去，它请模型跑一次能证明结果的检查，并说明跑的是什么。它不拦任何东西：它就落在工具结果里，正是「已完成」这个说法被说出的地方；如果还有验证要做，模型被告知把这些步骤以进行中留在清单里。触发只看状态，从不为了找「测试」这类词去读内容，所以在任何语言下表现一致。

### 拒绝

一条清单被拒绝的每一条理由都会先收集起来，一次作答把它们全部列出。被拒绝的清单从不抵达会话，所以一次坏调用什么都不会改。

| 拒绝 | 何时 |
|---|---|
| `todos must be an array` | 清单不是数组。 |
| `todos[i] must be an object` | 某一项不是对象。 |
| `todos[i].content must be a string` | 内容缺失或不是字符串。 |
| `todos[i].content must not be blank` | 内容为空或全是空白。 |
| `todos[i].content is N characters, over the max_content_chars of M` | 内容太长。 |
| `todos[i].status must be one of pending, in_progress, completed` | 状态缺失或不是三个值之一。 |
| `todos[i].<name> is not part of a todo item` | 这一项多了第三个字段。更广的生态在这个位置有 `activeForm`，这里点名拒绝，而不是静默丢掉。 |
| `todos carries N items, over the max_items of M` | 清单太长。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、配置、对 `session` 的调用与 `selfCheck`。 |
| [`src/todos.ts`](src/todos.ts) | `checkTodos`、`acknowledgement` 与 `verificationNudge`。 |

### 各项只在这里检查

参数语言只到两层：工具在顶层声明它的参数，`required` 与宿主来源都住在那层，而嵌套的 `items` 节点最多只能说 `{ type: "object" }`。在那个节点上声明 `additionalProperties: false` 会把每个字段都判成非法，因为它没有 `properties` 可以放行，所以单项形状改由 `run` 检查，违规随之作为工具结果回到模型。

### 一次调用

`run` 检查清单，带着会话 id、工作目录与清单去调 `session.save_todos`，再把回来的投影变成那一行确认。提醒加在 `session` 调用之后，从不加在前面，所以被会话拒绝的清单不会带上任何建议。工具的上下限是给模型看的尺度；会话持有更严的不变式 `MAX_TODO_ITEMS` 与 `MAX_TODO_CONTENT_CHARS`，任何调用方都抬不高。`max_items` 与 `max_content_chars` 的缺省故意落在这两条之下。

### 并发

对整份清单的写入来说，`never` 是诚实的答案：同一个会话的两次调用若并排跑，存下来的计划就归最后收手的那次。分发器因此让这个工具单独跑，而会话自己那把按会话的锁，保护文档不被「计划写入」与「消息写入」同时落盘。

五条事实界定了这个工具。它一次写一整份列表：没有单条的创建、更新或读取，条目之间也没有依赖图。可以同时有多个条目在进行中，这正是并行工作需要的，描述建议只留一个而没有东西强制它。提醒只是建议，所以跳过验证的模型不会被拦住，之后也没有东西重新读这份计划。没有为面板发布任何事件，所以计划只存在于会话文档与工具结果里。计划随会话一起消失，因为没有计划文件也没有跨会话列表。

-----

<a id="further-exploration"></a>
## 进一步探索

- [todo 组](../README.zh.md)：本工具所属的那一组。
- [session](../../session/README.zh.md)：持有计划的那个能力，以及它用来作答的投影。
- [tools](../../agent/tools/README.zh.md)：列出这个能力并注入宿主参数的分发器。
- [架构](../../../docs/architecture.zh.md)：组件地图与启动链路。
