---
description: "网关失败方言：规范化错误码、恢复策略写作时用的 kind 词汇，以及失败跨进程边界时的形状。"
kind: "package-reference"
---

# api-protocol

[English](README.md) | 中文

## 概述

一次网关调用失败时用的词。它只有一个文件、零依赖：调用没能给出回答的每一种方式对应的规范化错误码、每个错误码属于哪个 kind、失败跨进程边界时携带哪些字段，以及把错误对象或线上 payload 读成该形状的读取函数。数字错误码是适配器观察到的事实，kind 是部署配置策略时用的说法，因此配置里永远不出现数字。这里不重试、不等待、不做决定：它只命名事实，读事实的策略在别处。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 错误码

`GATEWAY_ERROR` 为网关调用失败的每一种方式命名一个错误码，`ABORTED` 则是调用被自己的调用方取消时携带的那一个。

| 常量 | 错误码 | kind |
|---|---|---|
| `GATEWAY_ERROR.auth` | `-32050` | `auth` |
| `GATEWAY_ERROR.rate_limit` | `-32051` | `rate_limit` |
| `GATEWAY_ERROR.server` | `-32052` | `server` |
| `GATEWAY_ERROR.transport` | `-32053` | `transport` |
| `GATEWAY_ERROR.parse` | `-32054` | `protocol` |
| `GATEWAY_ERROR.empty` | `-32055` | `empty_response` |
| `GATEWAY_ERROR.context_window` | `-32056` | `context_window` |
| `GATEWAY_ERROR.timeout` | `-32057` | `timeout` |
| `GATEWAY_ERROR.quota` | `-32058` | `quota` |
| `ABORTED` | `-32013` | `aborted` |

`-32602`，即请求被拒绝时携带的错误码，读作 kind `request`。本版本不认识的错误码读作 `unknown`，它不是对 kind 的猜测，而是在说这个失败没有人为它写过策略。

### kind

kind 是策略写作时的单位，因此 `isTransient(kind)` 回答的是策略是否可以考虑重试它。

| kind | 暂态 | 含义 |
|---|---|---|
| `rate_limit` | 是 | 网关在限制调用频率。 |
| `server` | 是 | 网关或请求在上游失败。 |
| `transport` | 是 | 连接断了。 |
| `timeout` | 是 | 迟迟没有回包，调用被放弃。 |
| `empty_response` | 是 | 调用结束了，但没给出任何内容。 |
| `context_window` | 否 | 对话已经装不进模型。 |
| `auth` | 否 | 凭证被拒，或者根本没找到凭证。 |
| `quota` | 否 | 账户里已经没有可用的额度。 |
| `request` | 否 | 请求本身被拒。 |
| `protocol` | 否 | 有 payload 读不出来。 |
| `aborted` | 否 | 调用方取消了。 |
| `unknown` | 否 | 没有人为这个失败写过策略。 |

`TRANSIENT_KINDS` 就是上表那一列，`FAILURE_KINDS` 是按顺序排列的全部 kind。

### 形状

| 类型 | 字段 |
|---|---|
| `ModelFailure` | `message`、`code`、`kind`，以及可选的 `status`、`retry_after_ms`、`request_id`。 |
| `FailureFacts` | 那三个可选字段本身：线上关于一次失败说过的话，这样下游就没有任何地方需要解析错误文本。 |

除 `message`、`code`、`kind` 之外的每个字段都是可选的，因为只有线上才知道自己有没有它；需要某个字段的策略要自己处理它缺席的情况。

### 读取函数

| 函数 | 输入 | 输出 |
|---|---|---|
| `kindOfCode(code)` | 一个数字 | 该错误码所属的 kind，或 `unknown`。 |
| `isFailureKind(value)` | 任意值 | 该值是否是 `FAILURE_KINDS` 之一。 |
| `isTransient(kind)` | 一个 kind | 策略是否可以考虑重试它。 |
| `readFacts(value)` | 任意值 | payload 携带的 `FailureFacts`，用不上的字段一律丢掉。 |
| `parseRetryAfter(value, now?)` | 一个 `Retry-After` 头 | 以毫秒计的等待时长，秒数和 HTTP 日期都认。没人能照做时返回 undefined。 |
| `failureOf(error)` | 一个抛出的值 | 该错误本身已经是的 `ModelFailure`，保留它的错误码与 data。 |
| `readModelFailure(value)` | 来自另一个进程的 payload | 那个 `ModelFailure`，任一必填字段缺失或不对时返回 null。 |
| `isModelFailure(value)` | 任意值 | 该值是否读得出 `ModelFailure`。 |

`failureOf` 从不抛错，也从不编造 kind：读不出错误码的错误变成 `-32603` 与 kind `unknown`。`readModelFailure` 逐字段校验，因为它的读者是一个不构造这份 payload 的进程，而那是唯一必须校验形状而不是信任形状的边界。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部内容：错误码、kind、形状、读取函数。 |

### 为什么每个错误码旁边都要有 kind

错误码是关于某一个适配器的事实，而适配器之间并不一致：同一个状况，一个提供方报成 HTTP 429，另一个只写在 body 里，第三个报成额度耗尽。部署没法在这样的东西上写策略，也不该为了说一句"稍后再试"而去命名一个数字。于是适配器报告它看到的错误码，`kindOfCode` 把它归约成 kind，策略写在 kind 之上。增加一个适配器意味着把它的各种状况映射到这些 kind 上，而不是每个提供方加一个 kind。

两条记录撑起这个方言。`BY_CODE` 是数字变成 kind 的唯一地方，所以不在里面的错误码就是 unknown，而不是被猜出来的。`TRANSIENT_KINDS` 是"有可能自己好起来"被写下来的唯一地方，它刻意包含 `empty_response`，因为一个什么也没答的网关值得再试一次。这里的东西一概不重试：适配器报告事实，只有策略才对事实动手，本包因此保持为两边都能 import 的叶子。

### 一次失败跨边界时携带什么

有三个可选字段跟着失败一起走，因为策略可能想要它们，而别处再也找不回来：`status`，网关答的 HTTP 状态；`retry_after_ms`，它要求的安静时长，已经从它写的任何一种形式换算过来；`request_id`，提供方的支持渠道会问你要的那个标识。`readFacts` 正是让它们可以被安全携带的东西，凡是既不是有限数字、又不是正数、又不是非空字符串的一律丢掉。跨进程边界的失败由 `readModelFailure` 校验，因为发送方是本进程没有构造过的进程；还留在本进程里、仍然是错误对象的失败由 `failureOf` 读取，它信任自己的代码路径。

-----

<a id="further-exploration"></a>
## 进一步探索

- [api](../README.md)：报告这些错误码、携带这些事实的适配器。
- [重试策略](../src/retry.ts)：用这些 kind 写成的策略，一个提供方地址一份。
- [api 包](../README.md)：本方言所属的组。
