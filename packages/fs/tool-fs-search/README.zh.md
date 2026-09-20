---
description: "glob 工具：在工作目录之下按路径模式找文件，包含它接受的模式语法、结果排序与封顶，以及它的链接策略。"
kind: "package-reference"
---

# tool-fs-search

[English](README.md) | 中文

## 概述

一个能力，`tool.glob`，以 `glob` 之名提供给模型。它走一遍目录树，把每条文件路径与模式比对，返回排好序的匹配路径。它从不读文件、从不写文件，也不跟随符号链接，除非 `follow_links` 这么说。因为只是走一遍，它能和别的调用并排跑。会话工作目录以宿主参数 `cwd` 送到，搜索范围还可以用可选的 `path` 进一步收窄。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### `glob`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `pattern` | string | 是 | 与搜索目录之下的每条路径比对。 |
| `path` | string | 否 | 要搜索的目录，相对工作目录。缺省是整棵树。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：`{ pattern, path, count, truncated, files }`，其中 `path` 是实际搜索目录的显示路径，`files` 里是排好序的匹配，`truncated` 表示是否因为封顶或走过长而截断。并发是 `always`。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_glob_results` | `200` | 一次 glob 最多返回多少条路径。 |
| `follow_links` | `false` | 是否进入或列出符号链接。 |

### 模式语法

| 模式里写 | 匹配 |
|---|---|
| `?` | 恰好一个字符，且不是路径分隔符。 |
| `*` | 任意长的一串字符，但不含路径分隔符。 |
| `**` | 任意长的一串字符，含路径分隔符。 |
| `**/` | 零个或多个完整段，所以 `**/*.ts` 能匹配根目录下的文件。 |

其余字符都是字面量；模式里的反斜杠按分隔符读，所以 Windows 形状的模式与正斜杠形状的表现一致。

### 拒绝

| 拒绝 | 何时 |
|---|---|
| `pattern must be a non-empty string` | 模式缺失或全空白。 |
| `path ... is outside the working directory` | 范围逃出工作区。 |
| `no such directory: ...` | 范围不存在。 |
| `... is not a directory` | 范围指向一个文件。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、配置与 `selfCheck`。 |
| [`src/glob.ts`](src/glob.ts) | `patternToRegExp` 与 `globFiles`。 |

### 一个模式变成一个两端锚定的表达式

`patternToRegExp` 逐字符走一遍模式，拼出一条两端锚定的正则。`**/` 变成 `(?:[^/]+/)*`，这正是让开头的 `**` 可以一个字符都不匹配的原因；而单独的 `**` 变成 `.*`。其余字符都做转义，所以模式里的点就是点，不是任意字符。

### 走这一遍

`globFiles` 用一个栈从搜索目录开始，一直弹到空。每个条目先分类，符号链接在 `follow_links` 不为真时直接丢掉，这正是让一条链接无法把一次有界的遍历变成死循环的原因。目录压进栈稍后处理，文件拿去匹配，而落在搜索目录之外的匹配，记录成相对工作区根的路径。最后把清单排序。有两件事会让遍历提前停下：达到 `max_glob_results`，以及访问条目超过五万；任一条都会把 `truncated` 置上。

-----

<a id="further-exploration"></a>
## 进一步探索

- [tool-fs](../tool-fs/README.zh.md)：打开本工具找到的东西所用的 `read`。
- [fs](../fs/README.zh.md)：本工具用来划定范围的 `resolvePath` 与 `displayPath`。
- [tools](../../agent/tools/README.zh.md)：列出这个能力的分发器。
- [fs 组](../README.zh.md)：库与插件怎么分工。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **不搜内容**：只比对路径，要在文件里找一段字得靠读或靠命令。
- **不读忽略文件**：没有任何东西会读 `.gitignore`，所以构建产物与依赖目录一样会被走到。
- **没有取反，也没有花括号展开**：`!` 与 `{a,b}` 都是字面量字符。
- **隐藏文件并不特殊**：点开头的文件与别的名字一样参与匹配。
- **大小写敏感跟着平台走**：匹配器本身区分大小写，所以 Windows 上的树也可能出现模式与它的大小写对不上的情况。