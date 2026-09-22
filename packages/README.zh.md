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
| `@maota/hooks-native` | [`hooks/hooks-native`](hooks/hooks-native/) | `hooks` | hook 引擎：发现那些 `hook.*` 能力、只问某个 hook 点归属的那些，再把它们的答案合并成一份。 |
| `@maota/permission` | [`interaction/permission`](interaction/permission/) | `permission` | 工具在破坏性命令前问的那道闸门：会话的档位、还在等回答的问题，以及成对留痕的审计文件。 |
| `@maota/pwsh-local` | [`shell/pwsh-local`](shell/pwsh-local/) | `shell` | 用本机 PowerShell 跑命令的 provider。 |
| `@maota/session` | [`session`](session/) | `session` | 存下来的会话、标题与工作目录，以及子代理文档带着的那条父链。 |
| `@maota/skill` | [`skill`](skill/) | `skill` | 一轮里提供给模型的技能清单。 |
| `@maota/skill-filesystem` | [`skill-filesystem`](skill-filesystem/) | `skill.filesystem` | 从文件系统取技能。 |
| `@maota/tool-fs` | [`fs/tool-fs`](fs/tool-fs/) | `tool.read`、`tool.write`、`tool.edit` | 模型借它读文件、写文件、改文件。 |
| `@maota/tool-fs-search` | [`fs/tool-fs-search`](fs/tool-fs-search/) | `tool.glob`、`tool.grep` | 按路径模式找文件、按正则找行的两个工具。 |
| `@maota/tool-pwsh` | [`shell/tool-pwsh`](shell/tool-pwsh/) | `tool.pwsh` | 模型借它跑命令的工具，也是先问闸门的那个。 |
| `@maota/tool-todo` | [`todo/tool-todo`](todo/tool-todo/) | `tool.todo_write` | 计划：模型写下任务清单用的那个工具，以及清单所住的那个会话文档。 |
| `@maota/tool-subagent` | [`subagent/tool-subagent`](subagent/tool-subagent/) | `tool.task` | 委派：把一件子任务交给一个自带上下文的代理、并且只带回它结尾那条消息的工具。 |
| `@maota/tools` | [`agent/tools`](agent/tools/) | `tools` | 工具注册表：每个工具都从这里列出与分发。 |
| `@maota/agent-loop` | [`agent/agent-loop`](agent/agent-loop/) |  | `agent-core` 在自己进程里跑的循环引擎：调用模型、执行工具、给出退出原因。 |
| `@maota/app-boot` | [`boot/app-boot`](boot/app-boot/) |  | 定下一次启动读哪个配置文件、跑哪个内核二进制，并生成某个 profile 的配置与链接。 |
| `@maota/base` | [`bundle/base`](bundle/base/) |  | `default` profile 挂载的那份行清单。 |
| `@maota/fs` | [`fs/fs`](fs/fs/) |  | 文件工具共用的工作区库：路径包含判定与原子写。 |
| `@maota/hook-protocol` | [`hooks/hook-protocol`](hooks/hook-protocol/) |  | hook 方言：四个事件、各自带的 payload、hook 用什么作答，以及多份答案怎么合成一份。 |
| `@maota/host` | [`boot/host`](boot/host/) |  | 拉起内核并在它的 stdio 上驱动：invoke、流、事件、停机。 |
| `@maota/plugin-kit` | [`plugin-kit`](plugin-kit/) |  | 上面这些包 import 的协议：分帧、channel、`runPlugin`、工具声明，以及配置键与 schema 检查。 |
| `@maota/shell` | [`shell/shell`](shell/shell/) |  | 命令接缝：请求与结果的形状，以及 `parseExitStatus`。 |
| `@maota/web-bundle` | [`bundle/web`](bundle/web/) |  | `serve` profile 在 `default` 那份之上追加的那一行。 |

<a id="bundles"></a>
一个 profile 的行来自这两份清单：`base` 按那份顺序挂载它点名的十五行，其中 `hmr` 是关着的；`web` 只加一行，所以只有 `serve` profile 会挂载它。启动器为每个 profile 持有一份清单（`default` 列 `base`，`serve` 列 `base` 再列 `web`），而某个 profile 实际用的那份住在 `$MAOTA_HOME/profiles/<name>/package.json` 里，所以加一个减一个都不必碰这个仓库。`web` 能力本身由 `apps/web` 提供，它不在这棵树里。

`pnpm check:plugins` 会用 `--check` 跑每个被拉起的包的入口，在没有内核的情况下校验 `provides`、`requires`、`configKeys` 与 `selfCheck`。

<a id="related-documentation"></a>
## 相关文档

- [架构](../docs/architecture.zh.md)：组件地图与启动链路。
- [maota CLI](../apps/cli/README.zh.md)：拉起这些包的前端。
- [agent](../agent/README.zh.md)：agent 那个包和它的循环怎么分工。
- [interaction](interaction/README.zh.md)：工具动手之前去问的那道闸门。
- [dev.hmr](boot/hmr/README.zh.md)：事件驱动热重载背后的 watcher。
