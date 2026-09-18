---
description: "开发期 watcher 插件：监视配置的 roots，发布 dev.source.changed，让宿主重启真正 import 了改动文件的插件。"
kind: "package-reference"
---

# dev.hmr

[English](README.md) | 中文

## 概述

`hmr` 只用于开发：它监视 `roots` 里点名的目录，把变动的路径以 `dev.source.changed` 发出去。别的都不由它决定, 宿主拿这个路径去过每个插件的模块图，重启 import 了它的那些插件。没加载这个插件的运行什么也不监视，所以生产配置只要不写这一行就行。它提供一个能力 `dev.hmr@0.1.0`，唯一的方法是 `status`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在改插件树、又想让内核把改动过的插件重启时，把这一行加进机器层。

### 打开这一行

生成的 `$MAOTA_HOME/eggshell.toml` 里这一行是关着的；把那个键改成 `false`，或在机器层把这一行重写一遍，就打开了：

```toml
[plugins.hmr]
disabled = false
command = "node"
args = ["<repo>/packages/hmr/src/main.ts"]
[plugins.hmr.config]
roots = ["<repo>/apps", "<repo>/packages"]
```

### 配置

| 字段 | 缺省 | 含义 |
|---|---|---|
| `roots` | `["apps", "packages"]` | 要监视的目录，相对插件的工作目录解析。不存在的条目跳过。 |

忽略表是固定的：变动路径里只要有一级是 `node_modules`、`.git`、`dist` 或 `target`，就什么都不发。变动先攒 100 ms，然后每个变动路径发一条 `dev.source.changed`。

### 事件

| 主题 | 载荷 | 含义 |
|---|---|---|
| `dev.source.changed` | `{ path }` | 被监视的文件变了一个；`path` 是绝对路径。 |

### 怎么确认它在工作

`invoke("dev.hmr", "status")` 会答 `{ roots, watching }`：它用了哪些 roots，以及有几个 watcher 活着。roots 全部消失的那次运行答 `watching: 0`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本节说明这个插件怎么把原始文件系统事件收敛成上面那一个主题；它读哪些配置见 [使用本包](#use-this-package)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/main.ts`](src/main.ts) | 整个插件：definition、watch 建立、去抖与 `status` |

### 监视与去抖

`start` 为每个存在的 root 开一个 `fs.watch(root, { recursive: true })`，并留住它发布用的 channel。原始事件先过忽略表，再解析成绝对路径放进 pending 集合；第一条落下时启动 100 ms 定时器，回调里每个 pending 路径发一条 `dev.source.changed`。`close` 清掉定时器、丢掉 pending 集合、关掉每个 watcher。发布失败只记一条 warning、不抛，所以一个坏路径不会弄停 watcher。

### 配置检查

`roots` 为空、或指向不存在的目录时，`selfCheck` 会让 `--check` 失败，所以 `pnpm check:plugins` 能在真正跑起来之前抓到拼错的目录名。

-----

<a id="further-exploration"></a>
## 进一步探索

- [packages 包组](../README.zh.md)：这个包所属的插件树。
- [maota CLI](../../apps/cli/README.zh.md#dev-hot-reload)：消费这些事件并重启插件的宿主。
- [架构](../../docs/architecture.zh.md#launch-path)：开发运行与生产运行差在哪。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制说明这个 watcher 在什么时候需要小心。它们是当前约束，不是任务积压。

- **Linux 上的递归监视是模拟出来的**：Windows 与 macOS 走原生，Linux 靠轮询，所以那边深目录更贵。
- **它发的是路径，不是归属**：路径归哪些插件，由宿主和它的模块图算。
- **缺失的 root 是跳过而不是等待**：下次插件启动才会再读一次，不会一直盯到它出现。
- **忽略表和去抖间隔写死在代码里**：都不可配置。
- **disabled 的行永远不会被拉起**：插件关着的时候，`--check` 也到不了它。
