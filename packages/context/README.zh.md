---
description: "context 组：在 PreModel 上增加模型可见上下文的独立 hook 插件。"
kind: "package-group"
---

# context/ ，请求上下文提供者

[English](README.md) | 中文

## 概述

Context 不是一个注册表。每个提供者都是独立的 hook 插件，声明实现 `PreModel`，并通过既有 hook 引擎贡献纯文本。引擎替它标注来源，`agent-core` 把结果存成持久的 user role 上下文。这里只有一个提供者：agent instructions。Memory 单独成组，因为它还定义模型工具。

## 目录

- [模块](#modules)
- [相关文档](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`agent-instructions`](agent-instructions/README.zh.md) | `hook.agent-instructions` 提供者：加载 `AGENTS.md` 与 `CLAUDE.md`，执行字节预算，并在每次模型调用前贡献它们。 |

<a id="related-documentation"></a>
## 相关文档

- [hooks](../hooks/README.zh.md)：引擎与 `PreModel` 事件。
- [memory](../memory/README.zh.md)：由模型维护的记忆提供者。
- [packages/ ，插件树](../README.zh.md)：哪个插件持有哪个能力。