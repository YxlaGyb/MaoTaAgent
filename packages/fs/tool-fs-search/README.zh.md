---
description: "搜索工具：在工作目录之下按路径模式找文件、按正则找匹配的行，包含模式语法、结果排序与各种封顶。"
kind: "package-reference"
---

# tool-fs-search

[English](README.md) | 中文

## 概述

两个能力，`tool.glob` 与 `tool.grep`，以 `glob` 与 `grep` 之名提供给模型。两者走的是同一棵目录树，也都不写任何东西：`glob` 把每条文件路径与模式比对，返回排好序的匹配路径；`grep` 读完遍历到的每个文件，返回正则匹配上的那些行，按文件分组。两者都不跟随符号链接，除非 `follow_links` 这么说，也都能和别的调用并排跑。会话工作目录以宿主参数 `cwd` 送到，两种搜索的范围还可以用可选的 `path` 进一步收窄。

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

### `grep`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `pattern` | string | 是 | 一条正则，逐行单独比对。 |
| `path` | string | 否 | 要搜索的目录，相对工作目录。缺省是整棵树。 |
| `include` | string | 否 | 文件路径必须匹配的单个正向 glob，例如 `**/*.ts`。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：一段文本。每个命中的文件单独占一行，写一次文件名，它下面的每条匹配跟着一行 `  Line N: <那一行>`，先按路径、再按行号排。什么都没找到时会说清楚是在哪里找的，并把模式原样引回去；被截断的搜索会在括号里补上原因，例如 `(stopped at the max_matches of 250, so 12 more matches are not shown)`。并发是 `always`。

用不了的正则当场报错，而不是给出空结果，而且诊断文字就是正则引擎自己的那一份，所以「没有匹配」永远意味着这条表达式编译得过、只是没匹配上。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_glob_results` | `200` | 一次 glob 最多返回多少条路径。 |
| `follow_links` | `false` | 是否进入或列出符号链接。 |
| `max_matches` | `250` | 一次 grep 最多返回多少条匹配。其余会被计数并报出来。 |
| `max_line_chars` | `2000` | 一条匹配行最多多少字符，按字符边界裁剪并补一个省略号。 |
| `max_file_bytes` | `1048576` | grep 最多读多大的文件。更大的会被跳过并计数。 |

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
| `pattern must be a non-empty string` | grep 的模式缺失或全空白。 |
| `pattern is not a usable regular expression: ...` | grep 的模式编译不过。 |
| `include takes one glob pattern, not a comma list` | `include` 里不止一个模式。 |
| `include cannot negate; pass one positive glob pattern` | `include` 以 `!` 开头。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、配置与 `selfCheck`。 |
| [`src/walk.ts`](src/walk.ts) | 共用的遍历：`patternToRegExp`、`searchBase` 与 `walkFiles`。 |
| [`src/glob.ts`](src/glob.ts) | `globFiles`：路径匹配与它的排序。 |
| [`src/grep.ts`](src/grep.ts) | `grepFiles`：行匹配、文件预算与渲染。 |

### 一个模式变成一个两端锚定的表达式

`patternToRegExp` 逐字符走一遍模式，拼出一条两端锚定的正则。`**/` 变成 `(?:[^/]+/)*`，这正是让开头的 `**` 可以一个字符都不匹配的原因；而单独的 `**` 变成 `.*`。其余字符都做转义，所以模式里的点就是点，不是任意字符。

### 走这一遍

`walkFiles` 用一个栈从搜索目录开始，一直弹到空，把遍历到的每个文件按「完整路径 + 相对工作区根的路径」交给调用方。每个条目先分类，符号链接在 `follow_links` 不为真时直接丢掉，这正是让一条链接无法把一次有界的遍历变成死循环的原因。目录压进栈稍后处理；访问条目超过五万时遍历停下，并报出访问过多少条。于是 `patternToRegExp`、`searchBase`、链接策略与那道条目上限都住在同一个文件里，两个工具对「范围是什么意思」和「能走到哪里」不可能给出不一致的答案。

### grep 怎么处理一个文件

`readBounded` 先 stat，超过 `max_file_bytes` 的直接放弃，然后一次性读出来；内容里带 NUL 字节的算二进制。这两种都跳过并计数，而不是硬搜，所以那条备注才说得出漏掉了多少个文件。内容按换行切开，每行单独测，匹配一直收到 `max_matches` 为止，之后只计数，好让备注报得出来。超过 `max_line_chars` 的行会被裁剪，且不会把一个代理对劈成两半；每个文件交出去的是显示路径，绝不是绝对路径。

`walkFiles` 本身不排序：`globFiles` 排它的路径清单，`grepFiles` 按路径与行号排它的匹配，各自的顺序各自负责。

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

- **不读忽略文件**：没有任何东西会读 `.gitignore`，所以构建产物与依赖目录一样会被走到。
- **没有取反，也没有花括号展开**：`!` 与 `{a,b}` 都是字面量字符。
- **跳过不等于失败**：超过 `max_file_bytes` 的文件，或带 NUL 字节的文件，会被略过并记进备注，所以一次搜索可能漏掉匹配却看起来像是成了。
- **一次匹配就是一行**：模式逐行测，所以任何东西都跨不过一个换行。
- **`include` 只吃一个 glob**：一次给好几个模式、或给一个取反的模式，都会被拒绝，而不是被解释出别的意思。
- **隐藏文件并不特殊**：点开头的文件与别的名字一样参与匹配。
- **大小写敏感跟着平台走**：匹配器本身区分大小写，所以 Windows 上的树也可能出现模式与它的大小写对不上的情况。
