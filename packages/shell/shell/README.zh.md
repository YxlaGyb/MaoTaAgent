---
description: "命令执行器所答的接缝：所有 shell provider 共用的请求与结果形状，以及把退出状态变成标签的那一个函数。"
kind: "package-reference"
---

# shell

[English](README.md) | 中文

## 概述

它是本组里最小的包，也是两边都认可的那一个。它持有两个接口与一个函数，不启动任何东西，不 import 仓库里的任何包，也不读配置。provider 答 `shell.run` 并交出 `ShellRunResult`；工具把那个结果渲染给模型；`parseExitStatus` 是对退出码的共用读法，这样两个渲染器不会对“被杀的进程长什么样”各说各话。它被 provider 与工具 import，自己不被拉起。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
const result = await ctx.channel.call("shell", "run", request, { signal });
const status = parseExitStatus(result);
```

| 导出 | 形状 | 含义 |
|---|---|---|
| `ShellRunRequest` | `{ command, workdir?, timeout_ms? }` | 调用方要什么。`command` 必填，且是整条命令行。 |
| `ShellRunResult` | `{ command, exit_code, signal, timed_out, truncated, stdout, stderr }` | provider 答什么。进程从未报出退出码时 `exit_code` 为 `null`。 |
| `parseExitStatus(result)` | `{ ok, label }` | 对一次已结束运行的共用读法。 |

| 状态 | `ok` | `label` |
|---|---|---|
| 这次运行超时 | 否 | `timed out` |
| 退出码为 0 | 是 | `exit 0` |
| 退出码是别的数 | 否 | `exit N` |
| 没有退出码但有信号 | 否 | `killed by SIG` |
| 两者都没有 | 否 | `no exit status` |

超时先于退出码检查，因为被杀掉的进程仍可能报出一个退出码。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | `ShellRunRequest` 与 `ShellRunResult`。 |
| [`src/render.ts`](src/render.ts) | `ExitStatus` 与 `parseExitStatus`。 |
| [`src/index.ts`](src/index.ts) | 再导出。 |

### 为什么结果不只是一段字符串

只返回输出的 provider 会丢掉四种情况之间的差别：命令成功、失败、被杀，以及根本没跑完。把 `exit_code`、`signal` 与 `timed_out` 分开，工具才能把这四种如实报出来；把 `truncated` 分开，读的人才能分得清“没有更多输出”与“没有更多位置”。

-----

<a id="further-exploration"></a>
## 进一步探索

- [pwsh-local](../pwsh-local/README.zh.md)：今天答这个能力的 provider。
- [tool-pwsh](../tool-pwsh/README.zh.md)：把结果渲染给模型的那个工具。
- [shell 组](../README.zh.md)：三个包怎么分工。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有流式**：结果在结束时一次到位，所以长命令在跑完之前什么都看不到。
- **环境不是值**：请求里不带环境，由 provider 自己决定。
- **只有一条命令行，没有 argv**：调用方写的是 shell 命令串，而不是程序加参数。
- **`signal` 是名字而不是数字**：平台报什么就原样传成文本。