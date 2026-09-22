---
description: "随包发货的技能提供者：它自己目录里的六个技能、最低的 rank，以及项目怎么替换其中一个。"
kind: "package-reference"
---

# skill-bundled

[English](README.md) | 中文

## 概述

部署随包发出的技能。其中六个住在这个包的 `skills/` 下，一个目录一个 `SKILL.md`，提供者以 rank 600 把它们交出去：低于每一个本地根，所以写了自己 `code-review` 的项目会替换掉随包那个，而不是与之相撞。六个里有三个讲的是本仓库，并在描述里写明这一点，因为同一套词在另一个有自己的布局的项目里是另一个意思。另外三个是普通的工程活，里面没有这个项目。它只回答 `list` 与 `load`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 六个技能

| 名字 | 讲什么 | 带条件 |
|---|---|---|
| `skill-authoring` | 仅限 MaoTa：`SKILL.md` 放哪、这一版读哪些键、`references/` 里放什么。 | 否 |
| `plugin-authoring` | 仅限 MaoTa：一个包、它的 manifest、plugin-kit 定义、能力名与 bundle 行。 | 是，`packages/**` |
| `doc-pairs` | 仅限 MaoTa：英文、中文与记录三件套、切换行、检查器强制的行文规则。 | 否 |
| `code-review` | 任何语言、任何项目里评审一处改动：边界、错误路径、清理、测试、报告什么。 | 否 |
| `debug-repro` | 任何语言、任何项目里诊断一次失败：复现、缩小、找到说谎的那层、证明修好了。 | 否 |
| `commit-and-pr` | 跑项目自己的检查、看清暂存了什么、写好消息、开出可评审的变更。 | 否 |

三个项目技能在描述里写明仓库名，并在正文第一段再说一次，这正是它们不会被套用到另一个碰巧用同一套词的项目上的原因。`plugin-authoring` 声明了 `paths: ["packages/**"]`，所以只有当会话碰过 `packages/` 下面的东西之后它才会出现在目录里；它同时也是条件激活的活样例。

### 配置

没有。这个提供者不读任何配置键，也没有可以改指的根：它的技能就在自己源码旁边的那些目录里。

### 两个方法

| 方法 | 参数 | 回答 |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`，每个随包技能一份，rank 都是 600，`source` 都是 `bundled`。 |
| `load` | `{ locator }` | `{ content }`：去掉 frontmatter 的正文。没有 path 的 locator 用 `-32602` 拒绝。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供者：`skills/` 在哪、`list`、`load` 与 `selfCheck`。 |
| [`skills/`](skills/) | 六个技能，各是一个 `<name>/SKILL.md`。 |

### 为什么一个包放六个技能

一个提供者想发多少个技能都行，而一个包就是一个提供者。把这六个拆成几个包什么也换不来：它们共享一个 rank、一个生命周期和同一个存在的理由，而注册表并不关心一个提供者交出多少候选。当一组技能会被另一个 profile 挂载、或者内容大到要单独发布时，第二个包才有它的位置。

### rank

600 低于每一个本地根，这正是关键：项目在 `.agents/skills` 里写一个同名技能就替换掉随包那个，而随包的文本留下当兜底。这个包里没有任何东西知道项目有哪些技能。

### 加第七个

加 `skills/<kebab-name>/SKILL.md`，frontmatter 的 `name` 等于目录名。`selfCheck` 会像注册表那样读这个目录，所以一个解析不了的名字、一个空的描述、或者一个错的 rank，都会在会话跑起来之前让 `pnpm check:plugins` 失败。

这六个是内容而不是代码：它们是模型读的散文，所以改动其中一个的行为就是改一份文档，`selfCheck` 能查的只有它们的形状。想让其中某一个消失的部署，用注册表的 `disable` 关掉它，而不是改这个包。

六个里有三个在 description 和正文第一段里写了 "MaoTa project only"。这是承重的：它们描述的是这个仓库自己的布局，挂载这个提供者的另一个仓库应该盖掉它们，而不是指望它们自己适配。另外三个是通用工程技能，一个项目名都没提。

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill](../skill/README.zh.md)：这些文件所用的方言，以及服务它们的注册表。
- [skill-filesystem](../skill-filesystem/README.zh.md)：rank 压过这一位的那个提供者。
- [技能](../../../docs/user/skills.zh.md)：从使用者角度看 frontmatter 契约与两层。
