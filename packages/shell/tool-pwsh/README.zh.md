---
description: "pwsh 工具：提供给模型的那一条命令、它的命令与超时参数、被注入的工作目录，以及它从 shell 能力渲染出的结果。"
kind: "package-reference"
---

# tool-pwsh

[English](README.md) | 中文

## 概述

一个能力，`tool.pwsh`，以 `pwsh` 之名提供给模型。它接一条命令行与一个可选超时，调用 `shell` 能力，并把 provider 答的东西渲染成状态、退出码与两路输出。它自己不启动任何进程，也不知道 PowerShell 的存在：可执行文件、环境与沙箱都在能力背后。会话工作目录以宿主参数 `workdir` 送到，每次调用都单独跑。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### `pwsh`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `command` | string | 是 | 要跑的命令行。 |
| `timeout_ms` | integer | 否 | 超过这么多毫秒就把命令杀掉。缺省用 provider 自己的 `timeout_ms`。 |
| `workdir` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |

### 结果

| 字段 | 含义 |
|---|---|
| `command` | 实际跑的那条命令行。 |
| `status` | 来自 `parseExitStatus` 的标签：`exit 0`、`exit N`、`timed out`、`killed by SIG` 或 `no exit status`。 |
| `ok` | 只有退出码为 0 时才为真。 |
| `exit_code` | 那个数字；进程没报出退出码时为 `null`。 |
| `timed_out` | provider 是否因为它跑太久而把它杀掉。 |
| `truncated` | 是否有某一路输出在字节上限处被截断。 |
| `stdout`、`stderr` | 两路输出的文本。 |

并发是 `never`：命令没有被声明为可以和别的调用并排跑，所以它永远单独跑。

### 依赖与配置

| 项 | 含义 |
|---|---|
| requires `shell ^1` | 本工具所调用的 provider 能力。`run` 转发给 `shell.run` 并渲染它的答案。 |
| `configKeys` | 无。超时、输出上限与兜底目录都归 provider。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、对 `shell.run` 的转发，以及 `selfCheck`。 |
| [`src/result.ts`](src/result.ts) | `renderPwshResult`。 |

### 这个工具是渲染器，不是执行器

`run` 由参数拼出请求，在模型没给 `timeout_ms` 时干脆不带这个字段，好让 provider 的缺省生效，并把这次调用自己的取消信号传下去。接着它把答案交给 `renderPwshResult`：后者经 `parseExitStatus` 补上 `status` 与 `ok`，其余字段原样透传。这个包里没有任何一处写出可执行文件的名字。

### 为什么 `workdir` 是宿主参数

模型拿不到工作目录参数，所以它没法把命令挪出会话目录。声明把 `workdir` 写作 `host: "session_cwd"`，这既让它不进公开 schema，又让它在运行期成为必填；`agent-core` 在调用之前从会话里把它填上。一个没带上它的调用，就是一个点名 `arguments.workdir` 的 `-32602`。

-----

<a id="further-exploration"></a>
## 进一步探索

- [pwsh-local](../pwsh-local/README.zh.md)：真正跑命令的那个 provider。
- [shell](../shell/README.zh.md)：与 provider 共用的请求、结果与状态类型。
- [tools](../../agent/tools/README.zh.md)：列出本工具的分发器。
- [shell 组](../README.zh.md)：三个包怎么分工。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有沙箱参数**：既没有升级途径，也没有申请理由的参数，所以需要更多余地的命令无处可问。
- **没有权限询问**：命令要么跑，要么不跑，中间没有别的选项。
- **环境方面什么都没提供**：模型没法为它启动的进程设一个变量。
- **`timeout_ms` 由模型自己选**：一次调用可以要求比 provider 缺省更久的等待，只有 provider 自己的上限能约束它。