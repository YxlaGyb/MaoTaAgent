---
description: "文件工具背后的工作区库：工作目录算什么、哪些路径在它里面，以及如何写文件才能让读的人看不到写一半的内容。"
kind: "package-reference"
---

# fs

[English](README.md) | 中文

## 概述

这个库持有每个文件工具在动手之前都得答的三个问题：工作区根在哪、一条路径是否在它里面、怎么写字才不会留下半截文件。它被两个文件插件 import，自己不被拉起，所以不读配置也不存状态。每一次拒绝都是一个 `-32602` 的 `CallError`，也就是模型看到的是参数层面的问题，而不是一次崩溃。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
const space = workspace(cwd, spillDir);
const target = resolvePath({ path: args.file_path, roots: space.read_roots, write: true });
writeAtomic(target, content);
```

| 导出 | 输入 | 返回 |
|---|---|---|
| `workspace(cwd, spillDir?)` | 会话工作目录，以及可选的第二个可读根。 | `{ root, read_roots }`。root 是 `cwd` 的真实路径；给了 spill 目录时，`read_roots` 是根本身再加上它。 |
| `existingRoot(dir)` | 一个目录。 | 它的真实路径。不是非空字符串、不存在、或者不是目录时失败。 |
| `resolvePath({ path, roots, write? })` | 待检查的路径、允许落在的根，以及这是不是一次写。 | 绝对目标路径。路径不可用或落到根外时抛错。 |
| `displayPath(root, target)` | 根与一个绝对目标。 | 该给模型看的形式：正斜杠、相对根；根自身显示为 `.`。 |
| `writeAtomic(target, content)` | 目标文件与它的全文。 | 无。先建父目录，写临时文件，再改名。 |

### `resolvePath` 拒绝什么

| 输入 | 原因 |
|---|---|
| 含空字节 | 文件系统承载不了。 |
| 盘符之后还有冒号 | 那会指向一个备用数据流。 |
| 以点或空格结尾的段 | Windows 会把它剥掉，于是两条路径变成同一个文件。 |
| 用 `..` 爬出去的相对路径 | 结果不在任何根之内。 |
| 落在所有根之外的绝对路径 | 同一条检查，发生在取真实路径之前。 |
| 最深的已存在祖先在根外 | 根内的一个链接不能用来够到根外。 |
| 写操作的目标是符号链接 | 穿过链接写会把文件放到别处。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/paths.ts`](src/paths.ts) | `Workspace`、`existingRoot`、`workspace`、`resolvePath` 与 `displayPath`。 |
| [`src/atomic.ts`](src/atomic.ts) | `writeAtomic`。 |
| [`src/index.ts`](src/index.ts) | 再导出。 |

### 包含判定查两遍

`resolvePath` 先用 `path.relative` 把拼好的路径与每个根比一次：结果是 `..` 或以绝对路径开头，就是在外面。接着它取目标最深的那个已存在祖先，用 `realpath` 解开，再比一次。第二遍是用来挡住链接把路径带出工作区的；而取“最深的已存在祖先”而不是整条路径，是为了让一次写能指向一个还不存在的文件。

### 写字，让读的人看不到半截

`writeAtomic` 在目标旁边建一个临时文件，名为 `.<名字>.<uuid>.tmp`，用独占创建标志与 `0600` 权限写全文，然后改名到目标上。同一个卷上的改名是原子的，所以读的人要么看到旧文件，要么看到新文件。改名失败会删掉临时文件并把错误抛出去。

-----

<a id="further-exploration"></a>
## 进一步探索

- [tool-fs](../tool-fs/README.zh.md)：建在本库之上的三个工具。
- [tool-fs-search](../tool-fs-search/README.zh.md)：用 `resolvePath` 给自己划定范围的搜索工具。
- [fs 组](../README.zh.md)：库与插件怎么分工。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **目标端不查 junction**：写操作拒绝符号链接，而已经指向根外的 junction 由包含判定那一遍拦住。
- **`displayPath` 不做解析**：它报告的是交进来的那条路径，所以拿着未解析路径的调用方看到的就是那个形态。
- **`writeAtomic` 假定同一个卷**：临时文件是目标的同级文件，这正是原子改名的前提，所以落在另一个卷上的目标不在覆盖范围内。
- **没有加锁**：两个写者对同一个文件都会成功，后改名的那次赢。
- **权限位在 Windows 上只是建议**：`0600` 与 `0700` 在平台认可的地方才会生效。