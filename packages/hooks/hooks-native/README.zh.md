---
description: "hook 引擎：hooks 能力、hook 插件怎么被发现、被问、被合并，以及一个坏掉的 hook 要付什么代价。"
kind: "package-reference"
---

# hooks-native

[English](README.md) | 中文

## 概述

hook 插件被发现的、被问的、被合并的，全在这一处。它提供 `hooks` 能力，找出内核公布的每一个 `hook.*` 能力、以及 profile 列出的命令 hook，只去问声明过本次事件的那些，再用 [`hook-protocol`](../hook-protocol/README.zh.md) 的规则把答案合成一份。它夹在两个永不见面的方向之间：`agent-core` 每个事件只调它一次并拿到一份合并好的答案，而 hook 插件只通过自己的能力被触达。任何一侧出问题都只记一条日志、当作没有意见，所以 hook 能收紧一轮，但永远弄不坏一轮。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 两个方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `trigger` | `{ event, payload }` | 合并后的 `HookOutcome`，形状由 `hook-protocol` 定义。没有挂任何 hook 时它是 `{}`，所有调用方都把它读成没有意见。十二个事件之外的名字是 `-32602`。 |
| `list` | 无 | `{ hooks, commands }`：每个应答过 `describe` 的 hook 一条 `{ capability, events }`（按名字升序），每个命令 hook 一条 `{ event, command, scope, matcher? }`。给运维看现在到底挂了什么。 |
| `register` | `{ scope, hooks }` | `{ registered, scope }`，会先换掉这个 scope 原有的内容。一次 run 借来的命令 hook 用它登记，结束时用同一个 scope 收回，所以两个 run 登记同一条命令不会互相撤掉。 |
| `unregister` | `{ scope }` | `{ removed, scope }`。收回一个没登记过的 scope 不是错误。 |

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `max_context_chars` | `4000` | 单条 context 的上限。每条各自截断，所以二十个 hook 每人都可以贡献这么多。 |
| `command_hooks` | 无 | profile 自己列的命令 hook，每条形如 `{ event, matcher?, command, timeout_ms? }`。它们挂在一个名为 `config` 的 scope 下，和插件给出的答案按同一套规则合并。 |
| `parallel` | `true` | 声明了同一个事件的 hook 是否同时被问。无论开不开，答案都按名字顺序合并。 |
| `strict` | `true` | 一个 `hook.*` 能力没有可用的 `describe` 要付什么代价。真就是启动失败；假就跳过并记一条 warning。 |

### 怎么写一个 hook

hook 就是一个提供 `hook.<name>` 能力的插件，用 `describe` 说出自己实现了哪些事件，并为每个声明的事件实现一个同名方法。每个方法收到的 payload、可以答的字段、以及合并规则都由 [hook-protocol](../hook-protocol/README.zh.md#use-this-package) 持有；这个包是那份契约的调用方。

命令 hook 是同一份契约、但不经插件：由 profile 在 `command_hooks` 下列出的脚本，或一次 run 为它自己的长度登记进来的脚本。它以 JSON 的形式在 stdin 收到 `{ event, payload }`，在 stdout 用一个 JSON 对象作答，别的都算没有意见。它的 `matcher` 在两个工具事件上把范围收窄到工具名，它的 `timeout_ms` 默认 10000，而它每跑一次都会在 `$MAOTA_HOME/audit/hooks.jsonl` 里留下一行，无论它答没答上来。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 定义：配置、`start` 时的发现、重建清单的订阅、两个方法与自检。 |
| [`src/engine.ts`](src/engine.ts) | `providerCapabilities`、`describeProviders` 与 `runHooks`：需要 channel、但不需要插件的那些部分。 |
| [`src/command.ts`](src/command.ts) | `CommandHook`、`runCommandHooks` 与审计：把 hook 当一个进程跑的那部分。 |

### 发现

`providerCapabilities` 留下所有以 `hook.` 开头的能力名，丢掉光秃秃的前缀，把剩下的排序。然后逐个问 `describe`；答不上来、或者声明的事件这个引擎一个都不认识的，记一条日志后排除，而不是照样被调用。能力表是唯一的登记处：没有要注册的、没有要注销的，挂上了就是被发现了。

交给 `start` 的表是一份快照，所以引擎同时订阅 `kernel.capabilities.changed`，用事件 payload 里的表重建清单。后加入或后来离开的 hook 因此也会被注意到，哪怕引擎先启动；profile 里的行序没有任何承重作用。

### 扇出与盖章

`collectHookContributions` 按名字升序走一遍，只问声明过本次事件的那些，payload 原样传下去。每份答案都盖上给出它的那个 hook，写成 `hook:<name>`，能力前缀折进了那个冒号，于是会话里最终留下的 context 消息点的是某个 hook，而不是某个插件 id。默认是同时问，所以答得慢的 hook 不会拖住排在它后面的，而无论开不开，答案都按名字顺序合并；同一轮里同一个事件被问两次，hook 就会被调两次。命令 hook 是一个进程而不是一次调用，所以它总是一起问；两组也同时问，合并时插件在前。

### 坏掉的 hook 没有意见

抛错的、连不上的、超时的 hook 什么都不贡献，`trigger` 也不会因为它抛出：这一轮拿着其余 hook 的答案继续走。这个方向是刻意的，因为 hook 下面那几层本来就是 fail closed 的：分类和工具自己的审批照旧执行，所以一个消失的 hook 最多是没能收紧一轮，绝无可能放宽一轮。超时沿用内核自己的每 provider `request_timeout_ms`；这个包不自带超时，而一个引擎无法作答的 payload 会被 `-32602` 拒掉，不会被猜着处理。

### 记了什么

每一轮发现、每一次调用都会经 channel 记一行：写清事件名、有没有被拒绝或放行，以及是哪些 hook 作的答。唯一被写下来的是命令 hook：每跑一次就往 `$MAOTA_HOME/audit/hooks.jsonl` 写一行，记下事件、scope、命令、退出码与它决定了什么。别的都留在内存里，所以插件 hook 的影响只有通过它注入会话的内容才是持久的。

### 自检

`selfCheck` 不需要内核，跑在一个假 channel 上：覆盖名字过滤与顺序、`describe` 必填、什么都不声明的 hook 被跳过、拒绝压过放行、context 的累积与截断、坏掉的 hook 不吞掉别人的拒绝、能力表变化后清单被重建，以及十二个事件之外的名字被拒。

五条事实界定了这个引擎。它的 hook 是带能力的插件，或者是 profile 列出的命令，所以两样都不是的 hook 进不来。没有任何持久记录记下插件 hook 拒绝过什么，因为一次决定记进日志之后就没了，而命令 hook 答没答上来都会留下一条审计行。hook 可以改掉一次调用运行时的参数、也可以改掉模型被告知它返回了什么，而改不了这次调用的其他任何东西。hook 默认被同时询问，所以列表里最慢的那个只有在 `parallel` 关掉时才决定整个点的节奏。能力表里没有 `hooks` 的部署会静默地关掉每一个插件 hook，这一点只在启动时记录一次，别处不再提。

-----

<a id="further-exploration"></a>
## 进一步探索

- [hook-protocol](../hook-protocol/README.zh.md)：这个引擎所套用的十二个事件、payload 与合并规则。
- [agent-core](../../agent/agent-core/README.zh.md)：调用 `trigger` 并把答案映射成循环决策的那座桥。
- [agent-loop](../../agent/agent-loop/README.zh.md)：桥接进去的那几个 seam。
- [hooks 包](README.zh.md)：这个引擎所属的组。
- [十二个 hook 点](../../../docs/user/hooks.zh.md)：一轮里的这十二个点，以及失败策略背后的那条不变式。
