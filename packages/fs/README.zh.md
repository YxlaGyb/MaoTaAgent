---
description: "fs 组：文件工具共用的工作区库、读改写三个工具，以及按模式找文件的 glob 工具。"
kind: "package-group"
---

# fs/ ,  文件访问

[English](README.md) | 中文

## 概述

读写与搜索文件是三个包：一个决定“一条路径算什么意思”的库，和两个把那个库变成模型可见工具的插件。库持有工作区根、包含判定与原子写，被 import 而不被拉起。插件被拉起，答 `tool.read`、`tool.write`、`tool.edit`、`tool.glob` 与 `tool.grep`，彼此之间一无所知。先在这一页挑对包，再打开它的目录看契约。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 目录 | 能力 | 职责 |
|---|---|---|---|
| `@maota/fs` | [`fs`](fs/) |  | 库：工作区根、路径包含判定、显示用路径与原子写。被两个插件 import，自己不被拉起。 |
| `@maota/tool-fs` | [`tool-fs`](tool-fs/) | `tool.read`、`tool.write`、`tool.edit` | 模型借它读文件、写文件、改文件。 |
| `@maota/tool-fs-search` | [`tool-fs-search`](tool-fs-search/) | `tool.glob`、`tool.grep` | 按路径模式找文件、按正则找匹配行的插件。 |

只读工具与写工具同包，搜索工具另起一包，因为搜索只是走一遍树，而写会改动它。两个插件互不 import，且都 import `@maota/fs`。

<a id="related-documentation"></a>
## 相关文档

- [tool-fs](tool-fs/README.zh.md)：三个文件工具的契约正本。
- [tools](../../agent/tools/README.zh.md)：两个插件都被它发现的那个分发器。
- [packages/ ，插件树](../../README.zh.md)：本组所属的那棵树。
