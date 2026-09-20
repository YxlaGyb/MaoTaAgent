---
description: "packages/ 这一层的包：各自提供什么，以及替别的包做掉什么。"
kind: "package-group"
---

# packages/

[English](README.md) | 中文

## 概述

`packages/` 下每个目录都是一个包，各自担一份职责：内核当独立进程拉起的、被别的包 import 的、定下一次启动怎么走的、给出某个 profile 行清单的。想找某个能力归谁，就在本页查到包，再打开它的目录。包级约定由各包自己的 README 负责，本页只说这里有什么。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

每个 profile 各自生成 `$MAOTA_HOME/profiles/<name>/eggshell.toml`，一个被拉起的包一行：行里只说明要跑哪个包，内核从该 profile 自己的 `node_modules` 里解析它，能力由进程自己报。

| 包 | 目录 | 能力 | 职责 |
|---|---|---|---|
| `@maota/agent-core` | [`agent/agent-core`](agent/agent-core/) | `agent.loop` | 前端真正对话的那个包：系统提示词、会话记账、工具装配与流式 `run`。 |
| `@maota/api` | [`api`](api/) | `api` | 模型网关：openai 后端，以及测试用的 scripted 后端。 |
| `@maota/hmr` | [`boot/hmr`](boot/hmr/) | `dev.hmr` | 开发期 watcher：为它盯着的路径发布 `dev.source.changed`，生成的那一行是 `disabled`。 |
| `@maota/session` | [`session`](session/) | `session` | 存下来的会话、标题与工作目录。 |
| `@maota/shell` | [`shell`](shell/) | `tool.shell` | 跑命令的那一个工具。 |
| `@maota/skill` | [`skill`](skill/) | `skill` | 一轮里提供给模型的技能清单。 |
| `@maota/skill-filesystem` | [`skill-filesystem`](skill-filesystem/) | `skill.filesystem` | 从文件系统取技能。 |
| `@maota/tools` | [`tools`](tools/) | `tools` | 工具注册表：每个工具都从这里列出与分发。 |
| `@maota/agent-loop` | [`agent/agent-loop`](agent/agent-loop/) |  | `agent-core` 在自己进程里跑的循环引擎：调用模型、执行工具、给出退出原因。 |
| `@maota/app-boot` | [`boot/app-boot`](boot/app-boot/) |  | 定下一次启动读哪个配置文件、跑哪个内核二进制，并生成某个 profile 的配置与链接。 |
| `@maota/base` | [`bundle/base`](bundle/base/) |  | `default` profile 挂载的那份行清单。 |
| `@maota/host` | [`boot/host`](boot/host/) |  | 拉起内核并在它的 stdio 上驱动：invoke、流、事件、停机。 |
| `@maota/plugin-kit` | [`plugin-kit`](plugin-kit/) |  | 上面这些包 import 的协议：分帧、channel、`runPlugin` 与配置键检查。 |
| `@maota/web-bundle` | [`bundle/web`](bundle/web/) |  | `serve` profile 在 `default` 那份之上追加的那一行。 |

<a id="bundles"></a>
一个 profile 的行来自这两份清单：`base` 按表里的顺序挂载它上面那八个包，其中 `hmr` 是关着的；`web` 只加一行，所以只有 `serve` profile 会挂载它。启动器为每个 profile 持有一份清单（`default` 列 `base`，`serve` 列 `base` 再列 `web`），而某个 profile 实际用的那份住在 `$MAOTA_HOME/profiles/<name>/package.json` 里，所以加一个减一个都不必碰这个仓库。`web` 能力本身由 `apps/web` 提供，它不在这棵树里。

`pnpm check:plugins` 会用 `--check` 跑每个被拉起的包的入口，在没有内核的情况下校验 `provides`、`requires`、`configKeys` 与 `selfCheck`。

<a id="related-documentation"></a>
## 相关文档

- [架构](../docs/architecture.zh.md)：组件地图与启动链路。
- [maota CLI](../apps/cli/README.zh.md)：拉起这些包的前端。
- [agent](../agent/README.zh.md)：agent 那个包和它的循环怎么分工。
- [dev.hmr](boot/hmr/README.zh.md)：事件驱动热重载背后的 watcher。