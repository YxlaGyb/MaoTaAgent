---
description: "boot 包组：一次 maota 启动怎么定下配置与内核二进制，以及 Node 宿主怎么在 stdio 上驱动 eggshell 内核。"
kind: "package-group"
---

# boot/

[English](README.md) | 中文

## 摘要

MaoTa 把 eggshell 内核当子进程跑，在 stdio 上跟它说话；boot 组管着这次启动的两半。改动「启动怎么找配置文件、怎么找内核二进制」，或改动「Node 这一侧怎么 invoke 能力、怎么收流、怎么订阅事件、怎么让内核停机」时读这里。这一组不含插件逻辑，也从不解释插件的配置值。它是库的家族，不是插件：这里没有任何东西会被挂进内核。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

CLI 把这两个组合起来，仓库里没有别的地方会拉起内核。

| 包 | 职责 |
|---|---|
| [`config`](config/README.md) | 为一次启动定下配置文件与内核二进制。 |
| [`host`](host/README.md) | 拉起内核，然后在它的 stdio 协议上 invoke、收流、订阅与停机。 |

<a id="related-documentation"></a>
## 相关文档

- [maota CLI](../../apps/cli/README.zh.md)：消费这两个包的启动器。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。

<a id="dev-note"></a>
## Dev Note

None.
