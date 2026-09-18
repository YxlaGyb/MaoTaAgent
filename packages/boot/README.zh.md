---
description: "boot 包组：一次 maota 启动如何定下配置与内核二进制，以及 Node 宿主如何在内核的 stdio 上驱动它。"
kind: "package-group"
---

# boot/ ,  启动粘合层

[English](README.md) | 中文

## 概述

MaoTa 把 eggshell 内核当子进程跑，双方在 stdio 上说话；这次启动的两半都归 boot 组。要改“一次启动怎么找到配置文件或内核二进制”，或者要改“Node 这一侧怎么 invoke 能力、收流、订阅事件、让内核停机”，就读这个组。本组不含任何插件逻辑，也从不解释插件的配置值。它是库家族而不是插件：这里没有任何东西被挂进内核。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

CLI 组合了这两个包，仓库里没有别的东西会拉起内核。

| 包 | 职责 |
|---|---|
| [`config`](config/README.zh.md) | 定下一次启动读哪个配置文件、跑哪个内核二进制，并在首次运行时生成 `$MAOTA_HOME/eggshell.toml`。 |
| [`host`](host/README.zh.md) | 拉起内核，然后在内核的 stdio 协议上 invoke、收流、订阅、停机。 |

<a id="related-documentation"></a>
## 相关文档

- [maota CLI](../../apps/cli/README.zh.md)：消费这两个包的启动器。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。
