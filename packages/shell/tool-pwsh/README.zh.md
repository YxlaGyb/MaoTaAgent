---
description: "pwsh 工具：提供给模型的那一条命令、它的命令与超时参数、被注入的会话身份、它在破坏性命令前发起的那次审批，以及它从 shell 能力渲染出的结果。"
kind: "package-reference"
---

# tool-pwsh

[English](README.md) | 中文

## 概述

一个能力，`tool.pwsh`，以 `pwsh` 之名提供给模型。它接一条命令行与一个可选超时，调用 `shell` 能力，并把 provider 答的东西渲染成状态、退出码与两路输出。它自己不启动任何进程，也不知道 PowerShell 的存在：可执行文件、环境与沙箱都在能力背后。会话工作目录以宿主参数 `workdir` 送到，每次调用都单独跑；而被权限闸门判定为破坏性的命令，会先问过用户才跑。由子代理发起的调用带着说明这件事的标签，所以那次提问说得出它来自哪个子代理。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### `pwsh`

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `command` | string | 是 | 要跑的命令行。 |
| `timeout_ms` | integer | 否 | 超过这么多毫秒就把命令杀掉。缺省用 provider 自己的 `timeout_ms`。 |
| `workdir` | string | 宿主 | 会话工作目录。由宿主注入，从不公开。 |
| `session_id` | string | 宿主 | 这次调用属于哪个会话，闸门据此按会话存策略。由宿主注入，从不公开。 |
| `call_id` | string | 宿主 | 这次工具调用的 id，用于把审批对上这次调用。由宿主注入，从不公开。 |
| `subagent` | object | 宿主 | 发起这次调用的子代理：`{ id, type, description }`。由宿主注入，从不公开；会话自己发起的调用没有它。 |

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

### 审批闸门

调用 `shell.run` 之前，本工具先读这个会话的权限策略。`full` 档下命令直接跑，什么都不问。其余情况下，一条含有本工具视为破坏性的三种形状之一（`rm `、`> /etc/`、`chmod 777`）的命令会先交给 `permission/request`，并且只有 `allowed-once` 这个回答才让它跑起来。

其它任何回答都会变成这个工具自己的结果：`{ command, status: "approval denied", ok: false, reason }`，其中 reason 说明收到的是哪个回答。于是拒绝是一条模型能读到的普通工具结果，而不是一个错误。

那次提问带着调用到达时的身份。由子代理发起的调用，来时带的是父的 `session_id` 与 `call_id`，外加一个 `subagent` 标签，所以问题落在派出这个子代理的那行工具下面，前端说得出是哪个子代理在问。这里不判断这个身份：它是注入的，模型既设不了也漏不掉。

这里的等待刻意比普通能力调用宽：`approval_timeout_ms`（缺省 300000）作为那次调用自己的 `timeout_ms` 传下去，因为内核的缺省会在三十秒后把一个问题掐掉。读不出策略时按"会问"的那一档处理，所以没有闸门的部署会拒绝一条破坏性命令，而不是放行它。

### 依赖与配置

| 项 | 含义 |
|---|---|
| requires `shell ^1` | 本工具所调用的 provider 能力。`run` 转发给 `shell.run` 并渲染它的答案。 |
| requires `permission ^1`（可选） | 闸门。没有它本工具照样加载，并把读不出的策略当成"会问"的那一档。 |
| `configKeys` | `approval_timeout_ms`：一次审批最多等多久，缺省 300000。命令超时、输出上限与兜底目录都归 provider。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 声明、读策略、对 `shell.run` 的转发，以及 `selfCheck`。 |
| [`src/approval.ts`](src/approval.ts) | 三种形状、理由、对闸门的调用，以及被拒绝时的结果。 |
| [`src/result.ts`](src/result.ts) | `renderPwshResult`。 |

### 这个工具是渲染器，不是执行器

`run` 由参数拼出请求，在模型没给 `timeout_ms` 时干脆不带这个字段，好让 provider 的缺省生效，并把这次调用自己的取消信号传下去。接着它把答案交给 `renderPwshResult`：后者经 `parseExitStatus` 补上 `status` 与 `ok`，其余字段原样透传。这个包里没有任何一处写出可执行文件的名字。

### 为什么这些身份走宿主参数

模型拿不到工作目录参数，所以它没法把命令挪出会话目录；它同样拿不到会话 id、调用 id 与子代理标签，所以它没法自称是别的会话、冒充某个它没被问过的问题的回答者，也没法自称是某个它并不是的子代理。这四个都声明了 `host` 来源，这既让它们不进公开 schema，又让它们在运行期成为必填；`agent-core` 在转发之前从会话和调用里把它们填上。一个少带参数的调用，就是一个点名那个参数缺失的 `-32602`；唯一的例外是子代理标签，会话自己发起的调用就是没有它。

四条事实界定了这些工具。没有沙箱参数，所以一个需要更多空间的命令没有地方去问。只有三种形状会被标记，`rm `、`> /etc/` 与 `chmod 777`，一个不含它们的破坏性命令会直接运行而不会被问。关于环境什么也没提供，所以模型无法为它启动的进程设置变量。`timeout_ms` 由模型自己选，只受 provider 自己的上限约束，而不受它的默认值约束。

-----

<a id="further-exploration"></a>
## 进一步探索

- [pwsh-local](../pwsh-local/README.zh.md)：真正跑命令的那个 provider。
- [shell](../shell/README.zh.md)：与 provider 共用的请求、结果与状态类型。
- [tools](../../agent/tools/README.zh.md)：列出本工具的分发器。
- [shell 组](../README.zh.md)：三个包怎么分工。
