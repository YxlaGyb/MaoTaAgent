---
description: "base 行清单：default profile 挂载的十五个插件、它们的挂载顺序，以及这个顺序为什么对工具分发器重要。"
kind: "package-reference"
---

# base

[English](README.md) | 中文

## 概述

这个包只装一个数组，别无他物：profile 挂载的那份行清单。每一行点明一个包，可选地带上一个配置块；启动器把这份清单变成生成的 `eggshell.toml`，并在 profile 目录里为每个包建一条链接。顺序也是契约的一部分，因为工具分发器是在 `start` 时从当时已存在的能力里发现工具的。`hmr` 是唯一一个带着 disabled 出厂的。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { rows } from "@maota/base";
```

| 导出 | 形状 | 含义 |
|---|---|---|
| `rows` | `PluginRow[]` | 那些行，按挂载顺序。 |
| `PluginRow` | `{ id, name, disabled?, config? }` | 一行。`id` 是配置块与日志行用的键，`name` 是要拉起的包。 |

### 这些行

| id | 包 | 能力 |
|---|---|---|
| `api` | `@maota/api` | `api` |
| `pwsh-local` | `@maota/pwsh-local` | `shell` |
| `permission` | `@maota/permission` | `permission` |
| `tool-pwsh` | `@maota/tool-pwsh` | `tool.pwsh` |
| `tool-fs` | `@maota/tool-fs` | `tool.read`、`tool.write`、`tool.edit` |
| `tool-fs-search` | `@maota/tool-fs-search` | `tool.glob`、`tool.grep` |
| `tool-todo` | `@maota/tool-todo` | `tool.todo_write` |
| `tool-subagent` | `@maota/tool-subagent` | `tool.task` |
| `tools` | `@maota/tools` | `tools` |
| `skill` | `@maota/skill` | `skill` |
| `skill-filesystem` | `@maota/skill-filesystem` | `skill.filesystem` |
| `session` | `@maota/session` | `session` |
| `hooks` | `@maota/hooks-native` | `hooks` |
| `agent-core` | `@maota/agent-core` | `agent.loop` |
| `hmr` | `@maota/hmr` | `dev.hmr`，缺省关着 |

### 顺序

五个 `tool.*` 插件与它们的 `shell`、`permission` provider 排在 `tools` 之前，`tools` 又排在 `agent-core` 之前。分发器在 `start` 时只读一次能力表，并把读到的东西缓存下来，所以一个尚未启动的 provider 要到下一次 `list` 才可见。让 provider 排在分发器上面，正是“启动一次就够”的原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/rows.ts`](src/rows.ts) | `PluginRow` 与 `rows`。 |
| [`src/index.ts`](src/index.ts) | 再导出。 |

### 一行怎么变成一个跑着的插件

`app-boot` 从本包 `package.json` 里读 `maota.bundle.rows`，import 那个文件，然后走一遍数组。它会拒绝跨 bundle 重复的 `id`，把点名的每个包链接进 profile 目录好让内核解析得到，并由这份清单渲染出生成的 `eggshell.toml`。带 `config` 对象的行会渲染成那个插件的配置块，被禁用的行会写成 disabled。

### 用户在哪里覆盖

生成的那个文件不是用户改的文件。profile 目录里还有 `eggshell.local.toml`，它 extends 生成的那份，而 `[plugins.tools.config]` 这样的配置块就该写在那里。由于一行只点一个包，别的不写，换 provider 意味着改行清单或改本地层，而不是改这个包。

-----

<a id="further-exploration"></a>
## 进一步探索

- [web bundle](../web/README.zh.md)：serve profile 在这份清单之上追加的那一行。
- [app-boot](../../boot/app-boot/README.zh.md)：读这份清单并生成 profile 的代码。
- [packages/ ，插件树](../../README.zh.md)：被点名的每个包各提供什么。
- [bundle 组](../README.zh.md)：行清单是什么。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **一个 bundle 一份清单**：profile 要么挂整个 bundle，要么一个都不挂，所以去掉一行意味着改这个数组。
- **顺序靠人手**：没有任何东西检查某个 provider 是否排在它的分发器上面，弄错了的表现就是某个工具干脆不见了。
- **这里没有逐行配置**：只有行自己带了配置块，生成的配置里才会有；其余都归用户的本地层。
- **被禁用的行照样写出来**：`hmr` 出现在生成的配置里，只是关着，所以想打开不必改别的。
