---
description: "tools 能力：每个工具插件都被它发现的注册表、agent 对话的 list、call、classify 三个方法，以及超预算落盘的结果预算。"
kind: "package-reference"
---

# tools/

[English](README.md) | 中文

## 概述

agent 从不直接调用工具插件。它调用这个分发器：从内核发布的能力表里发现所有以 `tool.*` 命名的能力，按名字排序，并答三个方法：给模型看的 `list`、干活的 `call`，以及判断一次调用能否与别的调用并排跑的 `classify`。每个工具只在这里留一条本地事实，也就是 `list` 时读过一次的策略；结果预算也归它：大到没法交给模型的答案会写到磁盘上，换成一个预览加一条路径。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 三个方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `list` | 无 | `{ tools }`，每个工具一条 spec，按名字排序。每条带 `name`、`description`、`input_schema`、`host_args`，以及它来自哪个 `capability`。 |
| `call` | `{ name, args }` | 工具自己的结果；超预算时是落盘信封。未知名字是 `-32602`。 |
| `classify` | `{ name, args }` | `{ safe }`。未知名字是 `-32602`；没有策略的工具答 `false`。 |

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_result_chars` | `20000` | 工具自己没声明预算时用的预算。返回的字符串按字符数计。 |
| `preview_chars` | `2000` | 落盘结果里内联带回来的那一段有多长。 |
| `spill_dir` | `$MAOTA_HOME/tmp/tool-results` | 落盘结果写在哪里。 |

### 落盘信封

超预算时，`call` 把整份答案写下去，返回 `{ spilled: true, path, chars, preview }`。目录按 `0700` 建，文件按随机名、`0600`、独占创建落在其中。之后模型可以用 `read` 工具读它，这也是为什么这两个插件声明同一个 `spill_dir`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/registry.ts`](src/registry.ts) | `TOOL_PREFIX`、`ToolRoute`、`discover` 与 `sorted`。 |
| [`src/index.ts`](src/index.ts) | 定义本体：配置、`start` 时的发现、三个方法、预算与落盘。 |

### 发现

`discover` 遍历内核在 `start` 时交过来的能力表，留下所有以 `tool.` 开头的名字，去掉前缀，余下为空的跳过。一条路由除了名字只带一条事实：`policy`，初始为 `null`，由 `list` 填上。既不答 `describe` 也不答 `policy` 的工具会被记一条日志并略过，而不是让整张清单失败。

### 安全与否是问出来的，不是猜出来的

`classify` 读缓存下来的策略。`"always"` 直接答 `true`，`"never"` 直接答 `false`，都不需要一次往返。策略是 `"args"` 时才转发给工具自己的 `classify`；失败、没有策略、或者答的不是严格 `true`，一律算 `false`。循环用的是同一条规则，所以没被分类的调用只会单独跑。

### 自检

`selfCheck` 覆盖纯函数部分：发现只挑 `tool.*` 的名字、`sorted` 把它们排好、没声明预算的落回 `max_result_chars`、`null` 表示永不落盘，以及一次落盘会把全文与字符数写在 `spill_dir` 下。

-----

<a id="further-exploration"></a>
## 进一步探索

- [tool-fs](../fs/tool-fs/README.zh.md)：本分发器会发现的 `tool.read`、`tool.write` 与 `tool.edit`。
- [agent-core](agent-core/README.zh.md)：列出这些工具、并注入它们宿主参数的调用方。
- [plugin-kit](../plugin-kit/README.zh.md)：`defineTools`，这些路由所答的声明形状。
- [agent 包](README.zh.md)：本分发器所属的组。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **发现只发生在 `list`**：后来才加入的工具插件，要等下一次 list 才被看见。
- **策略只缓存一份**：`list` 时读过的策略不会刷新。
- **预算按文本计**：字符串按字符数算，其余按它的 JSON 渲染算，所以一个大对象可能因为编码而落盘，而不是因为内容。
- **落盘文件从不清理**：没有任何东西会删掉旧的落盘结果。
- **没有权限层**：分发器只按名字路由，不做任何访问检查。