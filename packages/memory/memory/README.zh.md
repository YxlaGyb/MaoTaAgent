---
description: "memory 插件：固定预算的 USER.md 与 MEMORY.md、PreModel hook，以及模型记忆工具。"
kind: "package-reference"
---

# memory

[English](README.md) | 中文

## 概述

这个插件提供 `hook.memory` 与 `tool.memory`。hook 加载 `USER.md` 与项目的 `MEMORY.md`，执行扫描，并在每次模型调用前贡献一个有界上下文条目。工具通过唯一子串增加、替换或删除条目。存储写满时返回错误和当前条目，绝不自动驱逐。

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
| `PreModel` | 主会话返回一个上下文条目；子 agent 或两个存储都为空时返回 `null`。 |

### 工具

`memory` 工具接收 `target`（`user` 或 `memory`）、单个动作（`add`、`replace`、`remove`）、`content`、`old_text`，或原子的 `operations` 批次。

### 存储与配置

| 路径 | 含义 | 默认上限 |
|---|---|---|
| `$MAOTA_HOME/memories/USER.md` | 用户档案事实。 | `1375` 字符 |
| `$MAOTA_HOME/memories/<project>/MEMORY.md` | 项目与环境笔记。 | `2200` 字符 |

条目分隔符为 `\n§\n`。配置键 `user_char_limit` 与 `memory_char_limit` 修改两个上限。写入复用共享文件锁与原子替换。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`replace` 与 `remove` 通过唯一子串定位条目；`replace` 写入完整的新条目。容量按批次最终结果检查，不检查每一步的中间结果。无法无损往返的外部编辑会被拒绝并备份。不安全内容在持久化前拒绝，加载命中时替换为阻断提示。

-----

<a id="further-exploration"></a>
## 进一步探索

- [memory 组](../README.zh.md)：为什么 hook 与工具住在同一个插件。
- [hooks](../../hooks/README.zh.md)：事件与持久上下文条目。