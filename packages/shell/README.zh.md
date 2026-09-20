---
description: "shell 组：命令执行器所答的接缝类型、该能力背后的本机 PowerShell provider，以及模型调用的 pwsh 工具。"
kind: "package-group"
---

# shell/ ,  跑命令

[English](README.md) | 中文

## 概述

跑一条命令刻意分成三个包。库持有请求与结果的形状，以及把退出状态变成标签的那一个函数，被 import 而不被拉起。provider 通过真正启动 PowerShell 来答 `shell` 能力，将来换成沙箱 provider 时工具不用察觉。工具是面向模型的那一半：参数、说明与结果渲染。先在这一页挑对包，再打开它的目录看契约。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 目录 | 能力 | 职责 |
|---|---|---|---|
| `@maota/shell` | [`shell`](shell/) |  | 库：`ShellRunRequest`、`ShellRunResult` 与 `parseExitStatus`。被另外两个 import，自己不被拉起。 |
| `@maota/pwsh-local` | [`pwsh-local`](pwsh-local/) | `shell` | 用本机 PowerShell 跑命令的 provider。 |
| `@maota/tool-pwsh` | [`tool-pwsh`](tool-pwsh/) | `tool.pwsh` | 提供给模型的那个工具，名为 `pwsh`。 |

这样拆是为了让第二个 provider 能答同一个能力。一个沙箱执行器会用同样的方法、同样的结果形状来提供 `shell`，`tool-pwsh` 照样调 `shell.run` 不动，变的只是 profile 的行清单。

<a id="related-documentation"></a>
## 相关文档

- [pwsh-local](pwsh-local/README.zh.md)：一条命令到底是怎么起起来的。
- [tool-pwsh](tool-pwsh/README.zh.md)：`pwsh` 工具的契约正本。
- [tools](../../agent/tools/README.zh.md)：工具插件注册进去的那个分发器。
- [packages/ ，插件树](../../README.zh.md)：本组所属的那棵树。