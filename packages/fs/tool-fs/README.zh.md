---
description: "提供给模型的三个文件工具：带行号与窗口的 read、整文件替换或追加的 write、字面量替换的 edit，以及它们的参数、预算、拒绝与结果。"
kind: "package-reference"
---

# tool-fs

[English](README.md) | 中文

## 概述

一个插件，三个能力：`tool.read`、`tool.write` 与 `tool.edit`，以 `read`、`write`、`edit` 之名提供给模型。每个都只是 [`@maota/fs`](../fs/README.zh.md) 之上的一层薄壳：在工作区内解析路径、检查字节预算、干活。读永远可以和别的调用并排跑，也从不落盘；写与改各自单独跑。会话工作目录以名为 `cwd` 的宿主参数送到，所以模型既看不到它也挪不动它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### `read`

读一个 UTF-8 文本文件，带行号。

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `file_path` | string | 是 | 文件，相对工作目录，或落在工作区内的绝对路径。 |
| `offset` | integer | 否 | 从第几行开始读，从 1 起数。 |
| `limit` | integer | 否 | 读多少行。缺省 2000。 |
| `from_byte` | integer | 否 | 从第几个字节开始开窗，而不是从头。行号仍是文件自己的行号。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：选中的那些行，每行前缀是它的行号加一个 `|`。后面可能跟着括号里的两条提示：文件比字节上限更大，以及该从哪一行继续。用 `from_byte` 开的窗口报的是整个文件有多少行，而不是窗口里有多少行。并发是 `always`，结果永不落盘，所以长文件要么整份回来，要么按模型自己选的窗口回来。

### `write`

写一个 UTF-8 文本文件，整份替换或追加到末尾，并建好父目录。

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `file_path` | string | 是 | 文件，落在工作区内。 |
| `content` | string | 是 | 要写入、或要追加的文本。 |
| `mode` | string | 否 | `replace` 写整个文件，`append` 追加到末尾。缺省是 `replace`。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：`{ path, bytes, created, mode }`，其中 `path` 是显示用路径。并发是 `never`。

### `edit`

在一个 UTF-8 文本文件里替换字面量。

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `file_path` | string | 是 | 文件，落在工作区内。 |
| `old_string` | string | 是 | 要被替换的文本。除非 `replace_all` 为真，否则它必须只出现一次。 |
| `new_string` | string | 是 | 替换成的文本。 |
| `replace_all` | boolean | 否 | 替换每一处。 |
| `cwd` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

结果：`{ path, replaced, bytes }`。并发是 `never`。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_read_bytes` | `262144` | 一次读最多返回多少。它是一个窗口，而不是对可改文件大小的限制。 |
| `max_write_bytes` | `1048576` | 一次写或一次改最多能产出多少文本。 |
| `spill_dir` | `$MAOTA_HOME/tmp/tool-results` | 分发器的落盘目录，作为第二个根加入，好让 `read` 能打开落盘的结果。 |

### 拒绝

每一次拒绝都是 `-32602`，于是循环交给模型一个 `{ error }` 结果，这一轮继续。

| 拒绝 | 何时 |
|---|---|
| `path ... is outside the working directory` | 路径逃出根，发生在取真实路径之前或之后。 |
| `refusing to write through the link ...` | 写或改指向一个符号链接。 |
| `path ... is not usable: ...` | 含空字节、备用数据流，或以点或空格结尾的段。 |
| `no such file: ...` | 读或改指向一个不存在的文件。写则会把它建出来。 |
| `... is a directory; use glob to list it` | 读指向一个目录。 |
| `content is N bytes, over the M byte cap` | 写超过 `max_write_bytes`。 |
| `old_string appears N times in ...` | 改匹配到不止一处，而 `replace_all` 不为真。 |
| `old_string was not found in ...` | 改一处都没匹配上。 |
| `offset N is past the M lines of ...` | 读的起点越过了文件末尾。 |
| `invalid arguments: arguments.cwd is required` | 宿主没有注入工作目录。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 三份声明、配置，以及 `selfCheck`。 |
| [`src/read.ts`](src/read.ts) | 带窗口与行号的读。 |
| [`src/write.ts`](src/write.ts) | 整文件替换或追加的写。 |
| [`src/edit.ts`](src/edit.ts) | 唯一匹配与全局替换的改。 |

### 一份定义，三个能力

三份声明都走 `defineTools`，所以公开 schema、校验 schema、宿主参数与安全策略，都各由同一份声明编译一次。`cwd` 声明为 `host: "session_cwd"`，这既让它不进模型的 schema，又让它在运行期成为必填。内核寻址到哪个能力，插件就为哪个能力答 `describe`、`policy`、`run` 与 `classify`。

### 读一个窗口

读先 stat 文件，取文件大小与 `max_read_bytes` 中较小的那个，一次读进一个 buffer。它按 `\r\n` 或 `\n` 切行，丢掉末尾的空行，然后从 `offset` 起切 `limit` 行，并把每个行号补齐到最后一行的宽度。没读完的尾巴与没显示完的余量，都以括号提示的形式报告，而不是错误，因为长文件上这两件事都属正常。

### 安全地改

改按 64 KiB 的块走完文件，并带一段与 `old_string` 等长的尾巴，好让跨越块边界的匹配也能被找到。它先数匹配数，一次都没有就拒绝；多于一次且 `replace_all` 不为真也拒绝，这正是用来挡住“一个短串改错地方”的。改写流式写进目标旁边的临时文件，再改名盖过去，所以文件永远不会停在改了一半的状态，也从不整份驻留内存。

五条事实界定了这三个工具。用别的编码保存的文件会被读成替换字符，因为这里一切都是 UTF-8，而写也只写 UTF-8。`write` 要么整份替换要么追加，没有补丁模式，所以改文件中间要走 `edit`。读是从 `from_byte` 起取 `max_read_bytes`，所以带上字节偏移时，超出上限的行也能到达，字节偏移就是越过上限的办法。写与改都会上锁，进程内按路径互斥、跨进程用目标旁边的 `<file>.lock`，所以两轮不会在同一文件上交错。而 `read` 是那个可以和别的调用并排跑的能力，`write` 与 `edit` 各自单独跑。

-----

<a id="further-exploration"></a>
## 进一步探索

- [fs](../fs/README.zh.md)：这些工具所建的工作区与原子写库。
- [tool-fs-search](../tool-fs-search/README.zh.md)：列出 `read` 能打开哪些文件的 `glob` 工具。
- [tools](../../agent/tools/README.zh.md)：列出这三个工具、并注入 `cwd` 的分发器。
- [fs 组](../README.zh.md)：库与插件怎么分工。
