---
description: "Host 自有的项目注册、会话置顶与归档成员关系。"
kind: "package-reference"
---

# workspace

[English](README.md) | 中文

## 概述

`@maota/workspace` 拥有 Host 侧的项目列表，以及侧栏需要的两个全局会话集合：置顶会话与归档会话。它提供带 revision 的注册、重命名、移除、置顶和归档方法，把接受的修改原子写入 `$MAOTA_HOME/workspaces.json`，并发布 `workspace.changed`。移除项目只删除注册。会话仍留在磁盘上，先显示为未分组，同一路径重新注册后回到项目组。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `file` | string | `$MAOTA_HOME/workspaces.json` | 本插件读取和写入的项目文档。 |

### 方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `get` | 无 | `{ revision, projects, pinned_sessions, archived_sessions }`。文件不存在时读成 `{ revision: 0, projects: [], pinned_sessions: [], archived_sessions: [] }`。 |
| `register` | `{ path, name?, expected_revision? }` | 接受的视图。新路径追加 `{ path, name: name ?? null }`。已有路径重复注册是幂等的；省略 `name` 时保留已存名称。 |
| `rename` | `{ path, name, expected_revision? }` | 接受的视图。`name` 必须是字符串或 `null`；去空白后为空则变成 `null`。未知路径返回 `-32602`。 |
| `remove` | `{ path, expected_revision? }` | 接受的视图。只移除注册，并且是幂等的。会话和会话文件不受影响。 |
| `set_pin` | `{ session_id, pinned, expected_revision? }` | 接受的视图。`true` 把 id 移到 `pinned_sessions` 最前，并从 `archived_sessions` 移除；`false` 移除置顶。 |
| `set_archive` | `{ session_id, archived, expected_revision? }` | 接受的视图。`true` 移除置顶并把 id 加入 `archived_sessions`；`false` 恢复，但不恢复原来的置顶。 |

所有写方法都接受 `expected_revision`。不匹配返回 `-32061`；方法参数缺失或畸形返回 `-32602`；存储文档畸形返回 `-32603`。

### 事件

| 主题 | 载荷 |
|---|---|
| `workspace.changed` | 完整的已接受视图 `{ revision, projects, pinned_sessions, archived_sessions }`。 |

事件是尽力送达。错过的客户端可以调用 `get` 并按 revision 比较。

### 存储文档

| 字段 | 含义 |
|---|---|
| `schema_version` | 本版本写出的每份文档都是 `1`。 |
| `revision` | 每次接受的修改都会加一。 |
| `projects` | 按注册顺序保存的项目：`{ path, name }`，其中 `name` 是字符串或 `null`。 |
| `pinned_sessions` | 会话 id，最近置顶的在最前。 |
| `archived_sessions` | 归档的会话 id。置顶与归档集合互斥。 |

### 路径与会话语义

项目路径只去掉首尾空白后保存。不做大小写归一、分隔符重写或符号链接解析，所以存储路径必须与会话的 `cwd` 精确相等，Web 侧栏才会把会话放进项目组。`cwd` 未注册的会话进入未分组。重新注册同一路径会重新归组已有会话，不重写它们的文档。

### 声明

| 字段 | 值 |
|---|---|
| `provides` | `workspace` |
| `injects` | 无 |
| `registrations` | 无 |
| `hostCalls` | 无 |
| `configKeys` | `file` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 能力本体：项目与成员关系操作、revision 检查、事件与 `selfCheck`。 |
| [`src/store.ts`](src/store.ts) | 文档模型：默认值、读取、原子写入与 revision 比较。 |

### 带 revision 的写入

每个方法先读当前文档，再检查 `expected_revision`，应用一次纯更新，只有值变化时才写入下一个 revision。写入使用同目录临时文件和原子改名，权限为 `0600`。`workspace.changed` 只在改名完成后发布。

### 成员关系规则

`pinned_sessions` 是有序集合。重复置顶同一个 id 不产生写入；置顶一个已归档的 id 会在同一次写入中把它移出归档集合。`archived_sessions` 优先于置顶，恢复归档不会恢复之前的置顶。移除项目不检查会话存储，因为删除注册不可能产生无效的会话引用。

### 读取与失败

文档不存在时返回 revision 为零的空视图。不可读或畸形的文档以 `-32603` 拒绝，而不是用默认值覆盖。读取时去掉重复项目路径和两个会话数组中的重复 id，所以持久状态不会产生重复行。

-----

<a id="further-exploration"></a>
## 进一步探索

- [session](../../session/README.zh.md)：拥有会话文档的存储；本注册表只按 id 和工作目录引用它。
- [web bridge](../../../apps/web/src/bridge.ts)：RPC 面与侧栏事件转发。
- [base bundle](../../bundle/base/README.zh.md)：挂载这项能力的行清单。
