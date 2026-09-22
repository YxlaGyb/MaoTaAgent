---
description: "skill 组：持有 skill 方言与注册表的那个包，以及负责发现技能、随包发货、让模型读取的那三个包。"
kind: "package-group"
---

# skill/ ，技能

[English](README.md) | 中文

## 概述

技能是项目写下、或部署随包发出的指令：一个目录里一个 `SKILL.md`，从某个根被发现，只有任务匹配时才被读取。这一组就是整条链。[`skill`](skill/README.zh.md) 持有方言与注册表：frontmatter 规则、目录与正文的渲染，以及发现每个 `skill.*` 提供者的 `skill` 能力。[`skill-filesystem`](skill-filesystem/README.zh.md) 读本地那几个根。[`skill-bundled`](skill-bundled/README.zh.md) 在自己的目录里随包发出六个技能。[`tool-skill`](tool-skill/README.zh.md) 是模型那一侧：按名字把一个正文读出来的工具。

## 目录

- [包](#packages)
- [一个技能怎么到达模型](#how-a-skill-reaches-the-model)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 目录 | 能力 | 职责 |
|---|---|---|---|
| `@maota/skill` | [`skill`](skill/README.zh.md) | `skill` | 方言与注册表：frontmatter 投影、两个渲染器、rank 规则，以及把每个提供者交上来的东西合并起来的能力。为词汇被 import，为能力被拉起。 |
| `@maota/skill-filesystem` | [`skill-filesystem`](skill-filesystem/README.zh.md) | `skill.filesystem` | 本地提供者：项目的 `.agents/skills`、配置的 `dirs`、以及 `$MAOTA_HOME/skills`。 |
| `@maota/skill-bundled` | [`skill-bundled`](skill-bundled/README.zh.md) | `skill.bundled` | 随包发货的提供者：自己 `skills/` 下的六个技能，rank 最低。 |
| `@maota/tool-skill` | [`tool-skill`](tool-skill/README.zh.md) | `tool.skill` | 模型那一侧：`skill` 工具，按名字读一个正文并包好。 |

提供者就是任何提供 `skill.*` 能力的包，所以注册表并不绑定这两个：想从别处读技能的部署加一个包，这一层不用动。`skill-filesystem` 与 `skill-bundled` 是默认 profile 挂载的两个。

<a id="how-a-skill-reaches-the-model"></a>
## 一个技能怎么到达模型

目录与正文是两层，这个切分是成本决策：目录每个技能一行，待在对话里直到它变化为止；正文只在模型要的时候才被读，所以一个技能只在被用的时候才花掉它的全文。

| 步骤 | 谁 | 发生什么 |
|---|---|---|
| 1 | 某个提供者 | 扫自己的根，交出候选：名字、描述、认得出来的 frontmatter、rank，以及一个不透明的 locator。 |
| 2 | `skill` | 先按 rank、再按提供者名字合并，丢掉读不动的，然后回答 `list` 与 `catalog`。 |
| 3 | `agent-core` | 取一次 `catalog`，与历史里最新那份比较，变了才追加一条注记，所以没有东西移动时这一轮不多花 token。 |
| 4 | 模型 | 用确切的名字调用 `skill` 工具。 |
| 5 | `tool-skill` | 拿 `list` 校验名字与策略，再向 `skill` 要 `load`，把正文包好后返回。 |

`paths` 是唯一带条件的字段：声明了模式的技能会一直待在目录之外，直到这个会话碰过一条匹配的路径；碰过的路径是从存下来的历史里读回来的，所以这个条件能活过重启。

<a id="related-documentation"></a>
## 相关文档

- [技能](../../docs/user/skills.zh.md)：两层、frontmatter 契约，以及两个触发面。
- [packages/](../README.zh.md)：这个组所属的插件树。
- [agent-core](../agent/agent-core/README.zh.md)：注入目录并挂出那个工具的插件。
- [架构](../../docs/architecture.zh.md)：组件地图与启动链路。
