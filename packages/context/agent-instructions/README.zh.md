---
description: "agent-instructions hook：它加载的 AGENTS.md、CLAUDE.md、字节预算，以及它在 PreModel 贡献的内容。"
kind: "package-reference"
---

# context-agent-instructions

[English](README.md) | 中文

## 概述

这个插件贡献工作区指令，但不定义工具。它声明 `hook.agent-instructions`，并在 `PreModel` 回答一个上下文条目。加载器依次读取 `$MAOTA_HOME/AGENTS.md`，再从 Git 根到会话工作目录读取每一层的 `AGENTS.md` 与 `CLAUDE.md`。相同内容只加载一次，更具体的内容排在后面，完整集合受 `max_bytes` 限制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### hook

| 方法 | 回答 |
|---|---|
| `describe` | `{ events: ["PreModel"] }` |
| `PreModel` | `{ context: [text] }`，没有指令文件时为 `null`。 |

### 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `max_bytes` | `65536` | UTF-8 字节总预算。预算不足时先丢弃宽泛文件，再截断最具体文件。 |

项目根是最接近且含 `.git` 的祖先。没有 Git 根时只检查会话工作目录。本提供者不读取 `.claude/rules`、不展开 import，也不在启动后渐进发现嵌套文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

文本进入 hook 结果之前先执行安全检查。命中的指令文件会被替换成阻断提示，不会注入正文。读取失败或文件不存在时不产生条目，由 hook 引擎记录日志。

-----

<a id="further-exploration"></a>
## 进一步探索

- [context 组](../README.zh.md)：为什么这个提供者是 hook 而不是注册表条目。
- [hooks](../../hooks/README.zh.md)：事件与提供者契约。