---
description: "todo 组：唯一一个给模型一份它留得住的清单的包，以及这份清单写进的那个会话文档。"
kind: "package-group"
---

# todo/ ，计划树

[English](README.md) | 中文

## 概述

模型写下来的计划，比它记住的计划值钱。这一组持有的就是这份清单。这里住着一个包：[`tool-todo`](tool-todo/README.zh.md) 声明 `tool.todo_write` 能力，`tools` 分发器把它以 `todo_write` 之名提供给模型。工具自己不持有任何状态：它检查模型写下的清单，把它交给 `session` 能力，再用一行计数作答。计划本身住在会话文档里，所以它比工具调用、比插件进程、比这一轮活得更久。

## 目录

- [模块](#modules)
- [相关文档](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`tool-todo`](tool-todo/README.zh.md) | 计划的模型侧：`tool.todo_write` 能力、它接受的单项形状、它据以拒绝的上下限，以及它加在答案里的验证提醒。 |

`tool-todo` 和别的工具一样被发现：内核公布它的能力，`tools` 分发器列出它找到的东西，`agent-core` 把会话 id 与工作目录作为宿主参数注入。profile 配置拉起的是 `@maota/tool-todo`，由 `tool-todo/src/index.ts` 构建。

这一组里没有任何东西存计划。清单通过 `session` 能力写进会话文档，投影由那个能力给出，文件也由它持有。

<a id="related-documentation"></a>
## 相关文档

- [tool-todo](tool-todo/README.zh.md)：工具本身、它的配置与它的拒绝。
- [session](../session/README.zh.md)：持有计划的那个能力，以及计划住的那个文档。
- [tools](../agent/tools/README.zh.md)：列出并调用这个能力的分发器。
- [packages/ ，插件树](../README.zh.md)：哪个插件持有哪个能力。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。
