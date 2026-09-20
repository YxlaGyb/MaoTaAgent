---
description: "本机 PowerShell provider：一条命令行是怎么被拉起的、选哪个可执行文件、给它什么环境，以及输出、超时与取消各有什么边界。"
kind: "package-reference"
---

# pwsh-local

[English](README.md) | 中文

## 概述

这个 provider 通过启动一个真实的 PowerShell 进程来答 `shell` 能力。它接一条命令行、一个工作目录和一个超时，答一个退出码、一个信号、两路输出，以及两个标明是否超时、是否被截断的标志。它读三个配置键，调用之间不存状态。第二个 provider 可以用同样的方式答 `shell`，这也是它从不出现在工具契约里的原因。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `run` | `{ command, workdir?, timeout_ms? }` | `ShellRunResult`：`command`、`exit_code`、`signal`、`timed_out`、`truncated`、`stdout`、`stderr`。 |

`command` 必须是非空字符串，否则这次调用是 `-32602`。`workdir` 落回 `cwd` 配置键，`timeout_ms` 落回 `timeout_ms` 配置键。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `timeout_ms` | `30000` | 一次调用最多让命令跑多久。 |
| `max_output_bytes` | `65536` | stdout 与 stderr 各自最多留下多少字节。 |
| `cwd` | 无 | 调用方没给目录时在哪个目录里跑。 |

### 命令行

子进程按 `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` 起，命令行作为单个参数传入，从不拼成一整串，所以引号不会漏进可执行文件自己的参数解析。每次调用都是一个全新的进程：没有 profile、没有交互提示，调用之间也不留状态。

### 环境

| 覆盖 | 值 | 原因 |
|---|---|---|
| `NO_COLOR` | `1` | 别让颜色转义混进被捕获的文本。 |
| `PAGER` | `cat` | 别让命令停下来等分页器。 |
| `GIT_PAGER` | `cat` | 对 Git 同理。 |

父进程环境的其余部分原样传下去。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 定义本体：配置、`run` 方法与 `selfCheck`。 |
| [`src/pwsh.ts`](src/pwsh.ts) | `runPwsh`、编码前言、环境覆盖与可执行文件查找。 |

### 到底跑哪个可执行文件

`pwshCandidates` 在设了 `MAOTA_PWSH` 时先给 `MAOTA_PWSH`，然后是 `pwsh`，再是 `powershell`，重复的去掉。`runPwsh` 按顺序试，只有启动失败且错误为 `ENOENT` 时才往下走；别的失败立刻上报。所有候选都失败时，这次调用是一个 `-32603`，并带上最后一个错误。

### 编码在命令之前就设好

命令行前面会加一段固定前言，把 `[Console]::OutputEncoding` 与 `$OutputEncoding` 都设成不带 BOM 的 UTF-8。没有它，输出里的非 ASCII 字符会先被控制台代码页弄坏，Node 才拿到。

### 一次运行的几道边界

每路输出各自按 `max_output_bytes` 封顶，分别计算，第一个放不下的块就把 `truncated` 置上。定时器在 `timeout_ms` 时杀掉进程并置 `timed_out`。取消信号也会杀掉它，哪怕信号在 spawn 返回之前就已经触发，下一行仍会把子进程杀掉。结果从进程的 close 事件里解出来，所以被杀掉的进程仍会报出平台给出的退出码或信号；一旦落定，定时器与取消监听都会摘掉。

-----

<a id="further-exploration"></a>
## 进一步探索

- [shell](../shell/README.zh.md)：本 provider 用来作答的请求与结果形状。
- [tool-pwsh](../tool-pwsh/README.zh.md)：调用这个能力的工具。
- [shell 组](../README.zh.md)：三个包怎么分工。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有沙箱**：命令以宿主进程的全部权限运行。
- **没有后台命令，也没有常驻会话**：每次调用都是新进程，所以在一次调用里设的 shell 变量到下一次就没了。
- **输出是丢弃而不是折叠**：超过上限的字节直接不要，工具只报告这一路被截断。
- **上限是按路算的**：stdout 与 stderr 各有 `max_output_bytes`，所以一次运行最多可能返回两倍那么多。
- **杀就是杀**：对终止请求不予理会的进程，不会被升级成更强的手段。