---
description: "插件分组地图：MaoTa 交付的每个内核插件、各自提供的能力，以及内核拉起的入口。"
kind: "package-group"
---

# packages/ ,  插件树

[English](README.md) | 中文

## 概述

这里的每个目录，要么是内核作为独立进程拉起的插件，要么是插件树共用的库。插件在 stdio 上说 eggshell 协议，绝不被另一个进程 import；能力归属由插件自己在 `initialize` 回复里声明，内核只按声明路由。想找某个能力归谁，就在本页查到插件，再打开它的目录。包级约定由各包自己的 README 负责，本页只描述这里有什么。

## 目录

- [插件](#plugins)
- [库](#libraries)
- [相关文档](#related-documentation)

-----

<a id="plugins"></a>
## 插件

生成的 `$MAOTA_HOME/eggshell.toml` 里每个插件一行：内核跑 `command` + `args`，能力由进程自己报。

| 插件 | 能力 | 入口 |
|---|---|---|
| [`agent`](agent/) | `agent.loop` | `src/main.ts` |
| [`api`](api/) | `api` | `src/main.ts` |
| [`hmr`](hmr/) | `dev.hmr` | `src/main.ts` |
| [`session`](session/) | `session` | `src/main.ts` |
| [`shell`](shell/) | `tool.shell` | `src/main.ts` |
| [`skill`](skill/) | `skill` | `src/main.ts` |
| [`skill-filesystem`](skill-filesystem/) | `skill.filesystem` | `src/main.ts` |
| [`tools`](tools/) | `tools` | `src/main.ts` |

`hmr` 只用于开发，生成的那一行是 `disabled`。 [`apps/web`](../apps/web) 是应用而不是包，提供 `web`。 `pnpm check:plugins` 会用 `--check` 跑每个入口，在没有内核的情况下校验 `provides`、`requires`、`configKeys` 与 `selfCheck`。

<a id="libraries"></a>
## 库

| 目录 | 职责 |
|---|---|
| [`plugin-kit`](plugin-kit/) | 插件协议在 Node 这一侧：分帧、channel、`runPlugin`、配置键检查。上面每个插件都 import 它。 |
| [`boot`](boot/) | 宿主侧的启动粘合：一次运行读哪个配置文件、跑哪个内核二进制，以及驱动内核的 Node 宿主。 |

<a id="related-documentation"></a>
## 相关文档

- [架构](../docs/architecture.zh.md)：组件地图与启动链路。
- [maota CLI](../apps/cli/README.zh.md)：拉起这些插件的前端。
- [dev.hmr](hmr/README.zh.md)：事件驱动热重载的 watcher。
