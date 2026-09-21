---
description: "web bundle：serve profile 在基础集之上追加的那一行，以及挂载它之后哪里变了。"
kind: "package-reference"
---

# web bundle

[English](README.md) | 中文

## 概述

这个包只装一行。它存在的理由，是让 `serve` profile 能挂载 web 前端，而 `default` profile 不必知道它存在：`base` 点名每次启动都要的十一个插件，这个 bundle 只在浏览器要连上来的地方补上第十二个。包名是 `@maota/web-bundle`，而目录是 `bundle/web`，因为 `web-bundle` 说明它是什么，`web` 说明它属于哪个 profile。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { rows } from "@maota/web-bundle";
```

| 导出 | 形状 | 含义 |
|---|---|---|
| `rows` | `PluginRow[]` | 一行，按挂载顺序。 |
| `PluginRow` | `{ id, name, disabled?, config? }` | 一行。`id` 是配置块与日志行用的键，`name` 是要拉起的包。 |

### 这一行

| id | 包 | 能力 |
|---|---|---|
| `web` | `@maota/web` | `web` |

### 挂载之后变了什么

| 之前 | 之后 |
|---|---|
| 两个 profile 都只挂 `base`。 | `serve` 挂 `base` 再挂这个 bundle，于是多出一行。 |
| HTTP 前端在 profile 目录里解析不到。 | `@maota/web` 被链接进来，和其余的一起启动。 |

这次启动的别的部分都不变：生成的配置多一个块，`default` 完全不受影响。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/rows.ts`](src/rows.ts) | `PluginRow` 与那一行 `rows`。 |
| [`src/index.ts`](src/index.ts) | 再导出。 |

### 为什么是 bundle 而不是开关

bundle 是一个包，所以 `serve` 可以在 `package.json` 的 `maota.profile.bundles` 下点名它，启动器用解析 `base` 的同一套方式解析它。把开关做在启动器里，等于把这个决定放进代码而不是放进 profile；而在代码里追加一行，`pnpm check:plugins` 也看不见，因为它正是走 bundle 清单来找该检查哪些入口的。

-----

<a id="further-exploration"></a>
## 进一步探索

- [base](../base/README.zh.md)：本 bundle 所加入的那份行清单。
- [bundle 组](../README.zh.md)：行清单是什么。
- [web 前端](../../../apps/web/README.zh.md)：这一行拉起的那个包，它在 packages 树之外。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **一行，无配置**：端口、是不是开发服务器，以及其余设置都归用户的本地配置层。
- **它不能删行**：bundle 只会加，所以一个想比 `base` 更少插件的 profile 得另立一个 bundle。
- **`default` 永远看不见它**：不带 serve profile 跑 CLI，没有任何迹象表明 web 前端存在。
