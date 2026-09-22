---
description: "本地技能提供者：它扫的那三个根、裁决重名的 rank、两种条目形状、目录包允许的嵌套深度，以及它的配置键。"
kind: "package-reference"
---

# skill-filesystem

[English](README.md) | 中文

## 概述

项目自己的技能从哪来。它扫三个根，把找到的每一样都作为候选交出去：项目的 `.agents/skills`、profile 配置的那些目录，以及 `$MAOTA_HOME/skills`。每个根都带着决定重名的 rank，项目最靠前，使用者自己的目录最后。frontmatter 被解析成一个开放的记录并交给 `projectSkill` 做投影，所以关于名字与布尔值的规则只住在一个地方，这个包只负责把结果报出来。它不认识目录、预算或模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 那几个根

| Rank | 根 | `source` |
|---|---|---|
| 100 | `<项目根>/.agents/skills` | `project` |
| 300 | `dirs` 配置里的每个目录 | `custom` |
| 400 | `$MAOTA_HOME/skills`，缺省 `~/.maota/skills` | `user` |

项目根是最近一个带 `.git` 的祖先，所以在子目录里开的会话照样能找到仓库发布的技能。往上一路都没有 `.git` 时，项目根就是会话自己的目录。相对的 `dirs` 项按那个目录解析，而不是按插件自己的目录。

rank 就是注册表用来裁决重名的东西，也是项目能替换掉部署随包发出的技能、而不必改动那份技能的原因。

### 两种条目形状

| 形状 | 读作 | `resourceBase` |
|---|---|---|
| `<name>/SKILL.md` | 目录包 | 那个目录 |
| `<name>.md` | 扁平条目 | 根本身 |

一个目录包最多可以嵌在根下面 `max_depth` 层，所以 `skills/ui/table/` 这种分组目录会被读到，而技能自带的 `references/` 与 `scripts/` 仍然不会变成它们自己的技能，没有 `SKILL.md` 的目录也不是技能。名字以 `.` 开头的文件或目录会被跳过。不管嵌在哪一层，技能的名字仍然必须等于它自己那个文件夹的名字。

### 配置

| 键 | 含义 |
|---|---|
| `dirs` | rank 300 的额外根，按给出的顺序。非字符串的项被忽略。 |
| `max_depth` | 一个目录包最多能嵌在根下面几层。默认 3，不是正整数的值回退到默认。 |

### 两个方法

| 方法 | 参数 | 回答 |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`，每个找到的条目一份，按根的 rank 顺序。 |
| `load` | `{ locator }` | `{ content }`：去掉 frontmatter 的正文。没有 path 的 locator 用 `-32602` 拒绝。 |

`locator` 是 `{ path }`，由 `list` 发出去，而不是从调用方接过来，所以一次 load 不可能指定某个根从没交出来过的文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部内容：根列表、项目根回溯、`list`、`load` 与 `selfCheck`。 |
| `@maota/skill` | `scanSkillRoot` 走一个目录，`projectSkill` 决定 frontmatter 是什么意思。 |

### 一条规则住在哪

决定一个技能能不能活下来的规则在 [`@maota/skill`](../skill/README.zh.md)，因为随包发货的那个提供者遵守同一套：kebab-case 名字、名字必须等于它的条目名、以及 fail closed 的布尔值。这个包加上去的是地理：哪些目录是根、按什么顺序、以及一个根对 `resourceBase` 意味着什么。不存在的根不是错误，这正是 `.agents/skills` 在项目里可选的原因。

### 正文为什么在这里没有大小上限

真正要紧的预算是目录那一份，它属于注册表，因为目录才是那个待在对话里的东西。正文是一个按名字要它的模型故意读一次的；在这里设上限只会截断指令，而省不下反复发生的成本。这个包早先有一个 `max_bytes` 键，就是按这个理由去掉的。

### 告警

扫描看不顺眼的每一样都会变成一行 `ctx.channel.log("warn", ...)`：读不了的文件、与条目不符的名字、不是布尔值的布尔值、不是列表的 `paths`。warn 是使用者唯一能查到某个技能为什么没出现的地方，所以消息里会写出文件名。

有两条事实决定了这个提供者的形状。它是同步的本地文件访问，所以住在一个服务后面的技能需要自己的提供者，而不是在这里再加一个键；`MAOTA_HOME` 是建根列表时查的，不是启动时查一次，这对测试是刻意的，在部署里也无害。

正确性从不依赖监听。每次调用都比较一次根的便宜签名，收到 `fs.watch` 事件就把缓存丢掉，所以监听只是让扫描更便宜，从不是让过期结果变正确的那一环。

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill](../skill/README.zh.md)：方言与注册表，包括 frontmatter 投影。
- [skill-bundled](../skill-bundled/README.zh.md)：通常与它挂在一起、随包发出技能的那个提供者。
- [技能](../../../docs/user/skills.zh.md)：使用者把技能放在哪，以及哪些键会生效。
