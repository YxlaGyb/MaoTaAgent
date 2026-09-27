---
description: "memory 组：独立维护固定预算、始终可见工作集的 hook 与工具插件。"
kind: "package-group"
---

# memory/ ，由模型维护的记忆

[English](README.md) | 中文

## 概述

Memory 独立于请求上下文。一个插件同时提供 `hook.memory` 与 `tool.memory`：hook 在每次模型调用前贡献有界记忆快照，工具让模型增加、替换或删除条目。存储是普通 Markdown，按字符数设上限，写满时绝不静默丢弃。

## 目录

- [模块](#modules)
- [相关文档](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`memory`](memory/README.zh.md) | `hook.memory` 提供者与 `tool.memory` 工具。 |

<a id="related-documentation"></a>
## 相关文档

- [context 组](../context/README.zh.md)：提供者如何解耦。
- [hooks](../hooks/README.zh.md)：`PreModel` 事件。
- [tools](../agent/tools/README.zh.md)：模型工具如何分发。