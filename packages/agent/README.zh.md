---
description: "agent 包：持有 agent.loop 的插件，以及它跑的循环引擎。"
kind: "package-group"
---

# agent/ ,  agent 插件

[English](README.md) | 中文

## 概述

`agent` 插件是用户真正对话的那个内核插件：它把一段已存会话加一条输入变成模型与工具的循环，并把结果流式送回。它在这里分成几块：读配置、拼提示词、管会话的插件侧；调用模型、执行工具的循环引擎；以及把这些工具列出并调起来的分发器。先在这一页挑对你要动的那一块，再进对应目录。

## 目录

- [模块](#modules)
- [相关文档](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`agent-core`](agent-core/README.zh.md) | 插件本体：`agent.loop` 能力、它的配置键、工具装配、会话记账，以及流式的 `run` 方法。 |
| [`agent-loop`](agent-loop/README.zh.md) | 循环引擎：调用模型、执行工具、给出退出原因。它不读配置，也不碰会话。 |
| [`system-prompt`](system-prompt/README.zh.md) | 提示词：`system-prompt` 能力、部署方组装用的段落与变量，以及它们注册进的作用域。 |
| [`tools`](tools/README.zh.md) | 分发器：`tools` 能力、工具注册表、结果预算与落盘。 |

profile 配置拉起的是 `@maota/agent-core`（由 `agent-core/src/index.ts` 构建）、`@maota/system-prompt`（由 `system-prompt/src/index.ts` 构建）与 `@maota/tools`（由 `tools/src/index.ts` 构建）。`agent-loop` 由 agent 那个入口 import，从不被单独拉起。

<a id="related-documentation"></a>
## 相关文档

- [packages/ ，插件树](../README.zh.md)：哪个插件持有哪个能力。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。
