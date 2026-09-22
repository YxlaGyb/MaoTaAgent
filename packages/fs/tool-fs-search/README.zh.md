---
description: "搜索工具：在工作目录之下按路径模式找文件、按正则找匹配的行，包含模式语法、结果排序与各种封顶。"
kind: "package-reference"
---

# tool-fs-search

[English](README.md) | 中文

## 概述

两个能力，`tool.glob` 与 `tool.grep`，以 `glob` 与 `grep` 之名提供给模型。两者走的是同一棵目录树，也都不写任何东西：`glob` 把每条文件路径与模式比对，返回排好序的匹配路径；`grep` 读完遍历到的每个文件，返回正则匹配上的那些行，按文件分组。两者都不跟随符号链接，除非 `follow_links` 这么说，也都能和别的调用并排跑。会话工作目录以宿主参数 `cwd` 送到，两种搜索的范围还可以用可选的 `path` 进一步收窄。两者都会读自己走过的那些 `.gitignore`，所以一次搜索看到的是人看到的树，而不是塞满构建产物的树。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### `glob`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `pattern` | string | 是 | 与搜索目录之下的每条路径比对。开头的 `!` 表示取反，`{a,b}` 表示任选其一。 |
| `path` | string | 否 | 要搜索的目录，相对工作目录。缺省是整棵树。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：`{ pattern, path, count, truncated, incomplete, skipped, files }`，其中 `path` 是实际搜索目录的显示路径，`files` 里是排好序的匹配，`truncated` 表示封顶把清单截断了，`incomplete` 表示遍历自己提前停下了，`skipped` 数的是那些从没到过匹配器跟前的条目：被 `.gitignore` 挡掉的、隐藏名字，以及策略不跟随的链接。并发是 `always`。

### `grep`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `pattern` | string | 是 | 一条正则，逐行单独比对。 |
| `path` | string | 否 | 要搜索的目录，相对工作目录。缺省是整棵树。 |
| `include` | string[] | 否 | 文件路径至少要匹配其中之一的那些 glob，例如 `["**/*.ts", "**/*.tsx"]`。 |
| `multiline` | boolean | 否 | 把整个文件当成一个整体来测，而不是逐行，于是命中可以跨过换行。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：`{ pattern, path, count, truncated, incomplete, skipped, matches, text }`。`text` 是模型读到的部分：每个命中的文件单独占一行，写一次文件名，它下面的每条匹配跟着一行 `  Line N: <那一行>`，先按路径、再按行号排；搜索没做全时，原因以括号补在后面，例如 `(stopped at the max_matches of 250, so 12 more matches are not shown)`。`matches` 把同样的命中作为记录交出来，`truncated`、`incomplete` 与 `skipped` 则带着那句话里说的那些计数。并发是 `always`。

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
| 开头的 `!` | 整条模式取反，所以 `!**/*.md` 匹配每一条不是 markdown 文件的路径。 |
| `{a,b}` | 任选其一，所以 `src/{tool,agent}/*.ts` 两个目录都匹配。 |

其余字符都是字面量；模式里的反斜杠按分隔符读，所以 Windows 形状的模式与正斜杠形状的表现一致。以点开头的名字不进遍历，除非模式自己点名了一个隐藏段，这就是 `**/*.ts` 永远不报 `.config.ts`、而 `**/.*` 会报的原因。

### 拒绝

| 拒绝 | 何时 |
|---|---|
| `pattern must be a non-empty string` | 模式缺失或全空白。 |
| `path ... is outside the working directory` | 范围逃出工作区。 |
| `no such directory: ...` | 范围不存在。 |
| `... is not a directory` | 范围指向一个文件。 |
| `pattern must be a non-empty string` | grep 的模式缺失或全空白。 |
| `pattern is not a usable regular expression: ...` | grep 的模式编译不过。 |
| `include must be a glob pattern, or a list of them` | `include` 带的不是模式，或者列表里混了这种东西。 |
| `include cannot negate; pass positive glob patterns` | `include` 里有一条模式以 `!` 开头。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、配置与 `selfCheck`。 |
| [`src/walk.ts`](src/walk.ts) | 共用的遍历：`searchBase`、`walkFiles`、链接策略、隐藏名字策略与条目上限。 |
| [`src/ignore.ts`](src/ignore.ts) | `.gitignore` 的读取：一个文件声明了哪些规则，以及在这些规则之上怎么做判断。 |
| [`src/glob.ts`](src/glob.ts) | `globFiles`：路径匹配与它的排序。 |
| [`src/grep.ts`](src/grep.ts) | `grepFiles`：行匹配、文件预算与渲染。 |

### 一个模式变成一个两端锚定的表达式

`patternToRegExp` 逐字符走一遍模式，拼出一条两端锚定的正则。`**/` 变成 `(?:[^/]+/)*`，这正是让开头的 `**` 可以一个字符都不匹配的原因；而单独的 `**` 变成 `.*`；`{a,b}` 变成一条择一；开头的 `!` 把整条式子变成一个否定前瞻，后面接不锚定的 `[\\s\\S]*`。其余字符都做转义，所以模式里的点就是点，不是任意字符。这个函数住在 `plugin-kit` 里，因为技能注册表用同一套规则去匹配 `paths`。

### 走这一遍

`walkFiles` 用一个栈从搜索目录开始，一直弹到空，把遍历到的每个文件按「完整路径 + 相对工作区根的路径」交给调用方。每个条目先分类，符号链接在 `follow_links` 不为真时直接丢掉，这正是让一条链接无法把一次有界的遍历变成死循环的原因。目录压进栈稍后处理；访问条目超过五万时遍历停下，并报出访问过多少条。进入一个目录时还会读它里面的 `.gitignore`，此前收拢到的规则决定它下面每一条的去留：规则把路径挡在外面，后面一条 `!` 又能把它请回来；遍历拦下的每一样东西——被忽略的、隐藏的、它不愿跟的链接——都计数，而不是悄悄地少掉。于是 `searchBase`、链接策略、隐藏名字策略与那道条目上限都住在同一个文件里，两个工具对「范围是什么意思」和「能走到哪里」不可能给出不一致的答案。

### grep 怎么处理一个文件

`readBounded` 先 stat，超过 `max_file_bytes` 的直接放弃，然后一次性读出来；内容里带 NUL 字节的算二进制。这两种都跳过并计数，而不是硬搜，所以那条备注才说得出漏掉了多少个文件。内容按换行切开、每行单独测，除非 `multiline` 要整个文件一次测完：那时每条命中的行号靠对行首做二分查找定位，命中文本折成一行，所以它读起来仍是一条。匹配一直收到 `max_matches` 为止，之后只计数，好让备注报得出来。超过 `max_line_chars` 的行会被裁剪，且不会把一个代理对劈成两半；每个文件交出去的是显示路径，绝不是绝对路径。

`walkFiles` 本身不排序：`globFiles` 排它的路径清单，`grepFiles` 按路径与行号排它的匹配，各自的顺序各自负责。

六条事实界定了一次搜索。忽略文件就是遍历自己路过的那些：一条规则在它被写下的地方被读，搜索目录之上的 `.gitignore` 不会被请教。超过 `max_file_bytes` 的文件、或带 NUL 字节的文件会被跳过并计数，而不是让调用失败，所以一次搜索可以漏掉匹配却看起来成功。`include` 是一串正向 glob，带否定的一条会被拒绝而不是被解释。隐藏名字不进遍历，除非模式点名了它；被忽略的目录整棵剪掉，所以 `skipped` 数的是被拦下的东西，不是它底下原来有多少个文件。匹配器跟着平台走：Windows 上不分大小写，别处区分大小写。

-----

<a id="further-exploration"></a>
## 进一步探索

- [tool-fs](../tool-fs/README.zh.md)：打开本工具找到的东西所用的 `read`。
- [fs](../fs/README.zh.md)：本工具用来划定范围的 `resolvePath` 与 `displayPath`。
- [tools](../../agent/tools/README.zh.md)：列出这个能力的分发器。
- [fs 组](../README.zh.md)：库与插件怎么分工。
