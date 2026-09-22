---
description: "存下来的对话：每个工作目录下、每个会话一个文档，装着消息、标题，以及模型写进去的那份计划。"
kind: "package-reference"
---

# session

[English](README.md) | 中文

## 概述

存下来的对话：每个会话、每个工作目录一个 JSON 文档，装着这一轮的消息、会话在列表里显示用的标题，以及模型持有那份计划。七个方法回答调用方：`list`、`load`、`save`、`delete`、`children`，以及计划那一对 `todos` 与 `save_todos`。文档是版本 3，整份写进临时文件再改名就位，写入过程按会话上锁。保存消息永远不会丢掉计划，版本 1 或 2 的文档在读入时被规范化，再写回时就是版本 3。文档可以带一条父链，子代理的会话就是这样存的：它留在父的目录里，不进出 `list`，只能经 `children` 找到。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `list` | 无 | `{ dir, sessions }`，按 `updated_at` 倒序，最新的在前。带父链的文档不列出来。 |
| `load` | `{ id, cwd }` | 文档，并把 `dangling` 算出来。从未写过的会话读出来是一份空会话。 |
| `save` | `{ id, cwd, title?, messages, parent? }` | 写下去的那份文档。 |
| `delete` | `{ id, cwd }` | `{ deleted }`。 |
| `children` | `{ id, cwd }` | `{ children }`：这段会话派出的子会话，最早的在最前，每一项都是 `list` 用的那种摘要。 |
| `todos` | `{ id, cwd }` | 计划的投影。 |
| `save_todos` | `{ id, cwd, todos }` | 写入之后的计划投影。 |

### 文档

| 字段 | 含义 |
|---|---|
| `schema_version` | 本版本写出的每份文档都是 `3`。 |
| `id` | 会话 id。 |
| `cwd` | 这个会话所属的工作目录，去掉结尾的分隔符。 |
| `title` | `list` 显示的内容。`save` 不带它时，保留已经存着的标题。 |
| `created_at` | 文档第一次被写下的时间。 |
| `updated_at` | 最后一次被写下的时间，两条写入路径都算。 |
| `messages` | 消息记录：就是 `agent-core` 组装并交回来的那个数组。 |
| `events` | 只增不改，每次计划写入一条：`{ kind: "todos.write", at, todos }`。本版本写出的文档总是带这个字段，一开始是空的。 |
| `parent` | 人打开的会话是 `null`；子代理的会话是那条指回派出它的会话的链接：`{ id, cwd, call_id, type, description }`。 |
| `dangling` | 不落盘：当最后一条消息是用户消息时由 `load` 置上，那正是「一轮没结束」的样子。 |

### 父链

子文档住在父自己的目录里，因为子代理拿到的是父的工作目录、也从不写到它外面；它的 `parent` 记着是谁派出了它、在哪个目录、挂在哪次调用下，以及那次调用带的标签。这条链接换来三个答案：`list` 不列带链接的文档，于是侧栏与搜索永远看不到子代理；`children` 返回某段会话派出的那些，最早的在最前；每份摘要都带着这条链接，所以重开一段旧会话的页面不加载任何东西就能把条目挂回那次调用下面。

交给 `save` 的 `parent` 必须点名一个会话 id，别的都会被拒绝。文件里形状不对的链接则读成没有链接：存下来的文档读得宽松，而进程自己拿到手的值是个 bug，值得拒绝。

### 计划

`save_todos` 追加一条带整份清单的事件，投影就是从这些事件折出来的。

| 字段 | 含义 |
|---|---|
| `revision` | 写入事件的条数。从未写过计划的会话读到 `0`。 |
| `updated_at` | 最后一条事件的时间，没有事件时为 `null`。 |
| `todos` | 最后一份快照，按模型写下的顺序。 |
| `counts` | `pending`、`in_progress` 与 `completed`，按这份快照数出来。 |

写一份空清单就是清除计划，revision 照常前进，所以盯着 revision 的调用方能看到每一次写入，包括把清单清空的那一次。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `dir` | `$MAOTA_HOME/sessions` | 文档住的地方，每个工作目录一个目录。 |
| `max_bytes` | `52428800` | 单份文档的上限，在写入之前检查。 |
| `max_path` | `250`（Windows 之外是 `4000`） | 一份文档最长可以解析到多长的路径。 |

### 拒绝

| 拒绝 | 何时 |
|---|---|
| `session id must match ...` | id 为空、过长，或带了 id 形状之外的字符。 |
| `session <id> already belongs to ...` | 另一个工作目录编码到同一个文件夹。 |
| `session path is N chars, over the max_path limit of M` | 文档会落在平台装不下的长路径上。 |
| `session <id> is over the N byte cap` | 文档连计划在内会超过 `max_bytes`。 |
| `todos must be an array` | 计划写入带的是别的东西。 |
| `invalid todos: ...` | 某项不是对象、内容全空白或超过 2000 字符、状态不是三个值之一，或带了 `content` 与 `status` 之外的字段。所有理由在一条消息里列全。 |
| `parent must name the session that spawned this one, got ...` | 交给 `save` 的链接不是对象，或其中没有一个可用的会话 id。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 能力本体：配置、七个方法与 `selfCheck`。 |
| [`src/store.ts`](src/store.ts) | 文档层：路径、读取、原子写入，计划的读取与追加，以及子会话的查找。 |
| [`src/plan.ts`](src/plan.ts) | 计划本身：单项形状、上下限、投影与事件过滤。 |

### 一次只有一个写入者

两条写入路径都走 `serially`，键是工作目录加会话 id，所以同一个会话的计划写入与消息写入永远不会交错：各自读出文档、改自己那一部分，再把整份文件写回去。写入本身是先在会话目录里写一个临时文件再改名，权限位 `0o600`，于是读者看到的要么是写入之前的文档，要么是之后的，绝不会看到半份。也正是这把锁，让 `save` 不会丢掉在它读出与写出之间被追加的那份计划。

### 各条写入路径拥有什么

`save` 拥有 `messages`、`title` 与 `updated_at`，并从它读到的文档里保留 `events`。`save_todos` 拥有 `events` 与 `updated_at`，保留其余全部，包括消息。两条路径都不改写对方的字段，这正是计划能活过一轮、消息记录能活过一次计划写入的原因。

### 版本

`load` 接受 `schema_version` 为 1 或 2 的文档，补上一个空的 `events` 与「没有父链」；完全没有版本字段的文档同样处理。其余情况按读不动的文件处理，损坏的文档也是这个下场。这样读过之后的第一次 `save` 会把文档写回版本 3，所以迁移只花一次写入，不需要单独的命令。形状不被本版本信任的事件或父链会被丢掉，文档的其余部分保留。

### 子会话是找出来的，不是列出来的

`childrenOf` 走一遍父自己的目录，留下 `parent.id` 正是被问那段会话的文档，先按创建时间、再按 id 排序，所以两个子会话落在同一毫秒里时答案也是稳定的。没有任何索引，链接丢了的文档就变回一段普通会话，而链接的好坏本就只取决于它被写进的那个文件。

### 上下限

`src/plan.ts` 里的 `MAX_TODO_ITEMS` 与 `MAX_TODO_CONTENT_CHARS` 是不变式：任何 `save_todos` 的调用方都无法让文档无界增长，而面向模型的那个工具另有一套更小、可配置的限额。文档自己的 `max_bytes` 依然是最后的兜底，计划和消息记录一起算。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-core](../agent/agent-core/README.zh.md)：每一轮都保存消息记录的那个调用方。
- [tool-todo](../todo/tool-todo/README.zh.md)：通过 `save_todos` 写计划的工具。
- [packages/ ，插件树](../README.zh.md)：哪个插件持有哪个能力。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **锁只在进程内**：两个宿主指向同一个 `$MAOTA_HOME` 时仍会写同一个会话，最后改名的那次赢。
- **事件只增不减**：每次计划写入都追加一份快照，没有任何东西会修剪它们，所以最终是 `max_bytes` 喊停。
- **`list` 会读遍所有文档**：没有索引，`sessions` 树一大，每次 `list` 都会整棵走一遍。
- **子会话对 `list` 不可见**：找到它的唯一路径是父的 `children`，所以父文档没了的子代理就是一段没人列得出来的会话。
- **读不动的文档会读成空会话**：损坏的文件、或来自更新 schema 版本的文档，回来都是空的，而下一次 `save` 会把它盖掉。
- **没有计划历史**：投影就是最后一份快照，事件不会单独作为一份列表暴露出去。
