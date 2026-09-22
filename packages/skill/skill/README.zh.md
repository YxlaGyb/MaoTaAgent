---
description: "skill 方言与注册表：frontmatter 投影、目录与正文两个渲染器、rank 规则，以及把每个 skill.* 提供者交上来的东西合并起来的 skill 能力。"
kind: "package-reference"
---

# skill

[English](README.md) | 中文

## 概述

一个包里住着两样东西，因为它们本来就是同一套词汇：每个提供者与消费方都说的方言，以及把提供者交上来的东西合并起来的注册表。方言是 frontmatter 投影、`SkillSummary` 与 `SkillCandidate` 两种形状、目录渲染器与正文渲染器。注册表提供 `skill`，方法有 `list`、`load` 和 `catalog`，它发现内核公布出来的每一个 `skill.*` 能力，并先按 rank、再按提供者名字裁决重名。提供者为这套词汇 import 这个包，profile 为那个能力拉起它，所以它只在以自己启动的进程里服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 能力

| 方法 | 参数 | 回答 |
|---|---|---|
| `list` | `{ cwd?, touched? }` | `{ complete, skills }`：每个技能一份摘要，按名字排序。只要有提供者或候选读不动，`complete` 就是 false。 |
| `load` | `{ name, cwd?, touched? }` | `{ skill }`：摘要加上 `content`。名字不认识、被关掉、或者 `paths` 什么都没命中的，都用 `-32602` 拒绝。 |
| `catalog` | `{ cwd?, touched? }` | `{ complete, entries, text }`：模型可以调用的那些条目，以及渲染好的整块文本。 |
| `conflicts` | `{ cwd? }` | `{ conflicts, disabled, total }`：每个被两个提供者同时给出的名字，带上赢家和被它遮住的那些。 |
| `disable` / `enable` | `{ name, cwd? }` | `{ disabled }`：这个部署当前不展示的名字。名字不认识时用 `-32602` 拒绝。 |

`cwd` 是会话的工作目录，决定提供者去扫哪个项目根。`touched` 是这个会话已经碰过的路径，它就是把一个带条件的技能激活的东西。`catalog_description_max`（默认 500）与 `catalog_max_chars`（默认 8000）是两个配置键，都是渲染出来的那一块的预算。

### 跨越边界的东西

| 类型 | 字段 |
|---|---|
| `SkillSummary` | `name`、`description`、`whenToUse?`、`source`、`provider`、`invocation`、`paths?`、`active`、`resourceBase?`、`allowedTools?`、`model?`、`hooks?`、`context?` |
| `SkillDefinition` | `SkillSummary` 加上 `content` |
| `SkillCandidate` | 去掉 `provider` 与 `active` 的 `SkillSummary`，加上 `rank` 与 `locator` |
| `SkillControl` | `tools_allow?`、`model?`、`hooks?`、`context?`：一次 run 的那一半，由工具结果带给 loop。 |

`provider` 是提供这个技能的能力名，消费方因此能说出它从哪来。没有 `paths` 的技能 `active` 恒为真，声明了模式且命中某个碰过的路径的也是。`resourceBase` 是这个技能自己那些文件所在的目录，也就是模型被告知去读 `references/`、`scripts/` 和 `assets/` 的地方。最后四个字段是一次 run 的那一半，`readControl` 就是把这些字段读成工具结果交给 loop 的东西的那个读取器。

### frontmatter 契约

提供者把 frontmatter 解析成一个开放的记录交给这里，由 `projectSkill` 决定它是什么意思。这些规则讲的是一个坏值要付出什么代价。

| 键 | 规则 | 坏值的代价 |
|---|---|---|
| `name` | kebab-case，且等于目录名或文件名。缺失时回退到条目名。 | 丢掉这个条目，并记一条 warning。 |
| `description` | 模型总会看到的那一行。回退到正文里第一段非标题段落。 | 连段落都没有时丢掉这个条目。 |
| `when-to-use` | 一个非空字符串，给人看，从不给模型。 | 省略这个字段，并记一条 warning。 |
| `paths` | 一组路径模式。 | 省略这个字段，并记一条 warning。 |
| `user-invocable` | 布尔值，可写 `true/false`、`yes/no`、`on/off` 或 `1/0`。 | 丢掉这个条目，并记一条 warning。 |
| `disable-model-invocation` | 同一套布尔拼写，取反后成为 `modelInvocable`。 | 丢掉这个条目，并记一条 warning。 |
| `allowed-tools` | 一组工具名。在它生效期间收窄这次 run。 | 丢掉这个条目，并记一条 warning。 |
| `model` | 一个非空的模型名。这次 run 余下的部分用它跑。 | 省略这个字段，并记一条 warning。 |
| `hooks` | 一组 `{ event, command, matcher?, timeout_ms? }`，行内写法或块状写法都可以。 | 省略这个字段，并记一条 warning。 |
| `context` | `inline`（默认）或 `fork`。 | 省略这个字段，并记一条 warning。 |

这一版读的每一个键都真的生效，不读的键被丢掉而不是当作 metadata 留着。坏值的代价跟着这个键管什么走。`user-invocable`、`disable-model-invocation` 或 `allowed-tools` 写坏会丢掉整个技能，因为把一个坏掉的控制读成"没写"就等于挂出一个作者已经关掉的技能、或者把它本来要收窄的工具面又放宽回去。`when-to-use`、`paths`、`model`、`hooks` 或 `context` 写坏只损失那个字段，因为它们都不决定这个技能存不存在。同一个键的两种拼写读的是同一个键，所以写成 `allowed_tools` 或 `when_to_use` 的文档不会被默默忽略。

### 提供者契约

提供者就是一个提供 `skill.<name>` 能力的插件，其中名字满足内核校验的能力名语法。

| 方法 | 参数 | 回答 |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`。 |
| `load` | `{ locator }` | `{ content }`：去掉 frontmatter 的正文。 |

`locator` 是提供者自己放在候选上的东西，对这个包不透明。答不上来、或者答出这一版读不懂的东西的提供者会抛错，代价是它自己这一份，而不是整次读取。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | 方言：`isSkillName`、条目与摘要类型、`summarize`、`projectSkill`、`parseFrontmatter`、`renderCatalog` 与 `renderSkillContent`。 |
| [`src/scan.ts`](src/scan.ts) | `scanSkillRoot`：把一个根读成目录包（`<name>/SKILL.md`，可嵌到这个根允许的深度）或扁平条目（`<name>.md`），外加 `rootStamp`，也就是带缓存的提供者比较的那个便宜签名。 |
| [`src/index.ts`](src/index.ts) | 注册表：发现、`collect`、三个方法与 `selfCheck`。 |

### 发现、合并与失败

`start` 读一次能力表，把每个以 `skill.` 开头的名字留下，就像工具分发器留下每个 `tool.` 名字一样。`list` 随后逐个问提供者，把候选先按 rank、再按提供者能力名、最后按该提供者给出的顺序排序，所以重名的赢家从不取决于某张表碰巧是怎么建起来的。两个提供者、同样的 rank、同样的能力名，那是配置错误，而不是这个包应该自己发明一条规则。

抛错、或者答出这一版读不懂的东西的提供者，会被记一条 warning 并且把 `complete` 置为 false。其他提供者的候选照旧回来，因为一个坏掉的提供者应该只赔上它自己那些技能，而不是整份目录。

### 提供者会听到什么

关于这个注册表的协议，有两条是刻意的而非顺带的。提供者每次调用只被读一次，所以磁盘上的改动在下一轮被看到，而不是下一个进程；提供者拿不到会走样的缓存，也拿不到能写错的失效通道。而 `paths` 同时决定一个名字要不要被挂出去、以及它的正文到底能不能读，所以 `load` 检查的是 `list` 检查的同一份碰过的路径集合：模型从上一轮记下来的名字，和它刚读到的名字，过的是同一道闸。

重名不是无声的：`conflicts` 报出赢家和被它遮住的那几行，`disable` 则是部署说清楚它要哪一个的地方。收窄、模型、以及一个技能带来的 hooks 都不是这个包的事。它只报出来就停；一次 run 拿它们做什么，属于收到那个结果的 loop，这也正是一个注册表不必知道工具是什么的原因。

### 两个渲染器

`renderCatalog` 写出一个 `<available_skills>` 块，每条一个 `<skill name="...">` 行，过长的描述按 `catalog_description_max` 截断，预算用尽时按 `catalog_max_chars` 停下并补一行 `<omitted count="n"/>`，最后一行告诉模型用确切的名字去调工具。这两个预算只在这个地方生效。

`renderSkillContent` 把读出来的正文包进 `<skill_content name="...">`，然后写出这个技能的目录，并说明这一块是指令而不是数据。后面这句话正是这块东西要被包起来的原因：正文是陌生人写的文本，模型被告知该怎么读它。

### 被 import 又被拉起

这个包是唯一既当插件又被 import 的那个：三个兄弟包为方言 import 它，profile 为 `skill` 能力拉起它。`runPlugin` 在模块作用域执行，所以一次 import 会在同一个 stdin 上再开一个服务端，于是一个插件会应答两遍；因此入口先问 `isPluginEntry(import.meta.url)`，只在该进程正是以自己启动时才服务。任何将来长出会 import 它的兄弟包的包，都要加同一道闸。

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill-filesystem](../skill-filesystem/README.zh.md)：读本地那几个根的提供者。
- [skill-bundled](../skill-bundled/README.zh.md)：随包发出六个技能的提供者。
- [tool-skill](../tool-skill/README.zh.md)：模型用来读正文的那个工具。
- [技能](../../../docs/user/skills.zh.md)：从使用者的角度看两层与 frontmatter 契约。
- [plugin-kit](../../plugin-kit/README.zh.md)：这个包复用的 `isPluginEntry`、工具 schema 与 glob 匹配器。

-----
