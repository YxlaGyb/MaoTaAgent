---
description: "system-prompt 能力：部署方组装成一段提示词的有序段落与变量、它们注册进的两层作用域，以及循环对话的四个方法。"
kind: "package-reference"
---

# system-prompt/

[English](README.md) | 中文

## 概述

循环拥有对话，但不拥有开场的话：`agent-core` 交出一轮对话已知的事实，拿回一个字符串。这个插件持有把事实渲染进去的注册表。段落是带顺序和作用域的文本，可以引用变量，也就是用事实或已注册的值填上的 `{{name}}` 空位。global 作用域与本轮自己的 session 作用域会合并，同名段落 session 遮蔽 global，结果按顺序再按名字排序，所以注册的先后永远看不出来。四个方法覆盖全部：`assemble`、`register`、`unregister`、`release`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 四个方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `assemble` | `{ session_id, cwd?, approval?, persona? }` | `{ text, sections, variables }`。`text` 是提示词，`sections` 按顺序列出参与组装的段落，`variables` 是可用变量的名字，已排序。 |
| `register` | `{ name, text, order?, scope?, interpolate? }` | `{ name, order, scope }`。同一作用域里名字已被占用是 `-32602`。 |
| `unregister` | `{ name, scope? }` | `{ removed }`，该作用域里没注册过这个名字时为 `false`。 |
| `release` | `{ scope }` | `{ scope, sections, variables }`，即丢掉的计数。释放 `global` 是 `-32602`。 |

### 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `persona` | 内置口吻 | 部署方对自己身份的声明，会替换 `persona` 段落的文本。 |

### 内置段落

| 段落 | 顺序 | 陈述什么 |
|---|---|---|
| `harness` | `-1000` | 部署方不该改写的唯一一行，点名 harness 与平台。永不插值。 |
| `persona` | `0` | 配置的人设，或本轮被交给的那一个。永不插值，所以带花括号的人设原样通过。 |
| `working-directory` | `900` | `working directory: {{cwd}}`；本轮没有工作目录时什么都不说。 |
| `approval` | `1000` | 每种策略一句话：`ask` 说明被标记的命令等待用户裁决且拒绝是终局，`auto` 说明无需询问即批准，`full` 说明命令直接执行。其他模式什么都不说。 |

### 已注册变量

| 名字 | 值 |
|---|---|
| `session_id` | 本轮的会话。 |
| `cwd` | 本轮的工作目录，没有时为空。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/render.ts`](src/render.ts) | `interpolate` 与 `joinBlocks`。 |
| [`src/registry.ts`](src/registry.ts) | `SECTION_ORDERS`、层次合并、校验器与 `Registry`。 |
| [`src/sections.ts`](src/sections.ts) | `DEFAULTS`、`HARNESS`、`approvalText` 与 `builtins`。 |
| [`src/index.ts`](src/index.ts) | 定义本身：配置、四个方法、内置段落的就座与自检。 |

### 段落与变量

段落带文本、顺序、作用域，以及是否插值。文本可以是字符串，也可以是事实的函数，内置段落正是靠这一点在无事可说时保持沉默：空段落被丢掉，而不是留下一个空段。变量是一个名字加字符串或事实的函数，段落引用了没人注册的变量会以 `-32602` 中止组装，而不是把空位交给模型。两张表都是按作用域分开的，作用域要么是 `global`，要么是 session id。

### 排序

`assemble` 按名字合并两层，所以同名的以 session 为准，然后按顺序再按名字排序。harness 自己用的数字是留了间隔的，而插件注册的段落默认 `0`，正好落在 harness 那一行与人设之间。同一作用域里不会有两个同名段落，所以这个排序是全序。

### 一轮的事实

`assemble` 把事实当参数收下，而不是自己去读，这才让本插件与会话、文件系统、权限无关：循环本来就要问策略、本来就知道工作目录，而被提示词陈述、又被循环依此行事的事实只传一次。`persona` 是例外，因为子 agent 要在一轮里覆盖部署方的口吻。缺失的事实是 `null` 而不是空字符串，所以"工作目录为空"和"没有工作目录"是两种不同的陈述。

### 自检

`selfCheck` 覆盖了够得着的部分：已知、带空白、未闭合、空名字的插值，未知名字抛错，块拼接丢弃空串，排序顺序，作用域与顺序的默认值，空白人设回退，重名与小数顺序被拒，变量解析，未知变量中止组装，移除，session 遮蔽与隔离，释放作用域，内置段落按顺序组装且不残留变量，本轮人设替换配置人设且不被插值，以及四个方法走线上的行为。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-core](agent-core/README.md)：每轮组装提示词并交出事实的调用方。
- [plugin-kit](../plugin-kit/README.md)：定义形状、channel 与 `runPlugin`。
- [agent 包](README.md)：本插件所属的分组。
