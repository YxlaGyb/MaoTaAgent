---
description: "hooks 包：持有 hook 方言的那个包，以及让 hook 插件能在一轮 agent 循环的四个点上说话的那个引擎。"
kind: "package-group"
---

# hooks/ ，hook 树

[English](README.md) | 中文

## 概述

循环引擎开了三个 seam，这一组就是部署挂在这些 seam 上的东西：hook 插件能在一轮 agent 循环的四个点上说话，而循环本身从来不知道有 hook 这回事。这里住着两个包。[`hook-protocol`](hook-protocol/README.zh.md) 持有方言：四个事件名、每个事件带的 payload、hook 用什么作答，以及多份答案怎么合成一份。它不依赖任何东西，也从不被拉起。[`hooks-native`](hooks-native/README.zh.md) 持有引擎：它发现内核公布出来的 `hook.*` 能力、逐个去问、合并它们说的话，并通过 `hooks` 能力回答 `agent-core`。`agent-core` 是那座桥，也是唯一同时认识两套词汇的文件：它调用引擎，再把答案翻译成各个 seam 已经声明的决策。

## 目录

- [模块](#modules)
- [相关文档](#related-documentation)

-----

<a id="modules"></a>
## 模块

| 目录 | 职责 |
|---|---|
| [`hook-protocol`](hook-protocol/README.zh.md) | 方言：`HOOK_EVENTS`、四种 payload 形状、`HookReply`、`HookOutcome`、`mergeHookOutcomes`，以及 `hook.*` 提供者契约。它不依赖任何东西，也从不被拉起。 |
| [`hooks-native`](hooks-native/README.zh.md) | 引擎：`hooks` 能力、对 `hook.*` 能力的发现、按名字升序的扇出、盖章与记录。 |

profile 配置拉起的是 `@maota/hooks-native`（由 `hooks-native/src/index.ts` 构建）。`hook-protocol` 由引擎和 `agent-core` 里那座桥 import，从不被单独拉起。hook 作者 import `hook-protocol` 拿类型，然后声明一个 `hook.<name>` 能力；这个能力就是全部登记手续，没有状态要维护，也没有要调的注册方法。

<a id="related-documentation"></a>
## 相关文档

- [四个 hook 点](../../docs/user/hooks.zh.md)：这四个事件落在一轮里的哪个位置，以及那条只能收紧的不变式。
- [packages/ ，插件树](../README.zh.md)：哪个插件持有哪个能力。
- [agent 包](../agent/README.zh.md)：这些 hook 挂上去的那三个 seam 属于哪个插件。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。
