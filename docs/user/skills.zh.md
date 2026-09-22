# 技能

[English](skills.md) | 中文

一个技能就是一个里面有 `SKILL.md` 的文件夹：一段只有当任务需要时才被模型读到的指令。本文从外面讲清这套安排：技能放在哪、哪些 frontmatter 键真的生效、一个坏值要付出什么代价、技能怎么走到模型面前又怎么走到人面前，以及一次 run 读进一个技能之后会变什么。

## 目录

- [两层](#two-levels)
- [技能放在哪](#where-a-skill-lives)
- [frontmatter 契约](#the-frontmatter-contract)
- [读一个技能](#loading-a-skill)
- [读进来的技能会改什么](#what-a-loaded-skill-changes-about-the-run)
- [给人看的部分](#for-people)
- [相关文档](#related-documentation)

-----

<a id="two-levels"></a>
## 两层

一个技能分两步被读到，这个切分就是整个设计。

目录那一层很便宜，而且一直在：每个技能一行，名字加描述，发过一次就留在对话里。它的预算是 `catalog_max_chars`（默认 8000），每条描述截到 `catalog_description_max`（默认 500）；哪一轮要发的还是同样的几行，就一行都不发。

正文那一层很贵，是按需读的：只有任务对上了才会来，而且它以指令的形式来，而不是以"指向某个文件"的形式来，因为一条还得再去取一次的指令，就是一条模型可能永远不读的指令。

所以描述是你写的最重要的那一行。它是触发器，不是摘要：用一个人会用来提这个要求的说法，去描述那个应该把它叫出来的任务。

<a id="where-a-skill-lives"></a>
## 技能放在哪

根按 rank 扫描，rank 更小的赢重名。

| Rank | 根 | 给人看的来源 |
|---|---|---|
| 100 | `<项目根>/.agents/skills` | `project` |
| 300 | `skill-filesystem` 的 `dirs` 配置里的每个目录 | `custom` |
| 400 | `$MAOTA_HOME/skills`（默认 `~/.maota/skills`） | `user` |
| 600 | `@maota/skill-bundled` 随包发出的那六个 | `bundled` |

项目根是最近一个带 `.git` 的祖先，所以在子目录里开的会话照样能找到仓库发布的技能。两种形状会被读到：文件夹 `<name>/SKILL.md`，扁平文件 `<name>.md`。文件夹最多能嵌在根下面三层，所以分组用的文件夹也能用。技能自带的 `references/`、`scripts/`、`assets/` 永远不会变成它们自己的技能。

根是被监听的，所以会话开着的时候新增或改过的技能，下一次读就能列出来。东西不会被复制到别处：文件夹就在它原来的位置被读。

<a id="the-frontmatter-contract"></a>
## frontmatter 契约

| 键 | 效果 | 坏值的代价 |
|---|---|---|
| `name` | kebab-case，且等于文件夹名或文件名。缺失时回退到条目名。 | 丢掉这个技能。 |
| `description` | 目录里的那一行，也是触发器。回退到正文第一段。 | 连段落都没有时丢掉这个技能。 |
| `when-to-use` | 给人看，从不给模型。 | 省略这个键。 |
| `paths` | 在某个碰过的路径命中模式之前，这个技能一直藏着。 | 省略这个键。 |
| `user-invocable` | `false` 会让它不出现在网页输入框的菜单里。 | 丢掉这个技能。 |
| `disable-model-invocation` | `true` 会让它不进目录，并拒绝那个工具。 | 丢掉这个技能。 |
| `allowed-tools` | 在它生效期间把这次 run 收窄到这几个工具。 | 丢掉这个技能。 |
| `model` | 这次 run 余下的部分改用这个模型。 | 省略这个键。 |
| `hooks` | 为这次 run 注册的命令钩子，run 结束时撤回。 | 省略这个键。 |
| `context` | `fork` 让正文自己跑一次，只回最后那段文字。 | 省略这个键。 |

布尔值可以写成 `true/false`、`yes/no`、`on/off` 或 `1/0`。同一个键的两种拼写读的是同一个键，所以 `allowed_tools` 和 `when_to_use` 也认。这一版不读的键会被丢掉，不会留着。

会丢掉整个技能的那三个键，正是一次 run 被允许做什么的决策者。把写坏的 `user-invocable`、`disable-model-invocation` 或 `allowed-tools` 读成"没写"，等于挂出一个作者已经关掉的技能，或者把它本来要收窄的工具面又放宽回去。其余几个只损失自己。

`paths` 是一组 glob 模式，拿会话已经碰过的文件去匹配。它是触发器而不是许可：它决定一个技能什么时候被挂出来，不决定它能读什么。

<a id="loading-a-skill"></a>
## 读一个技能

模型用目录里的确切名字调 `skill` 工具。在读到你的正文之前，这个工具先确认名字真实存在、技能对模型是开着的、以及带条件的技能确实命中了这个会话碰过的某个东西。一次拒绝只花一次调用，一个文件都不读。

回来的东西是包在 `<skill_content>` 块里的正文，后面跟一行写出这个技能所在的文件夹。后面那一行正是 `references/`、`scripts/`、`assets/` 的意义：模型只有在任务需要时才用普通的文件工具去读它们。

正文可以用 `$ARGUMENTS`（整个参数对象）和 `${key}`（取其中一个值）来要值。调用没填的占位符会原样留着，就按你写的那样。

<a id="what-a-loaded-skill-changes-about-the-run"></a>
## 读进来的技能会改什么

有四个键管的是这次 run，而不是那段文字。

`allowed-tools` 收窄工具面。它只会收窄：一次 run 里读进来的两个技能取交集，所以后一个打不开前一个关上的东西，也没有任何东西能放宽部署允许的范围。收窄一直持续到这次 run 结束。

`model` 为这次 run 余下的部分换模型。

`hooks` 为这次 run 注册命令钩子。每一个都是一个子进程，事件以 JSON 从 stdin 递过去，每一次运行都会追加到 `$MAOTA_HOME/audit/hooks.jsonl`。它们在 run 结束时被撤回，所以一个技能不会留下任何东西。

`context: fork` 让正文自己跑成一次 run，只回那次 run 最后那段文字。指令和工具往来都留在子进程里，发起调用的那一方拿到的是一个结果。被 fork 的正文再也够不到 skill 工具，所以一个技能没法经由自己递归。

<a id="for-people"></a>
## 给人看的部分

一个既 `user-invocable`、又对模型开着的技能，会出现在网页输入框的菜单里。选中它只是把 `Use the "<name>" skill.` 插进消息，而不是把正文展开，所以你发出去的指令仍然是你还能改的那一条，什么时候读它由模型决定。

侧边栏有一个只读的技能页，列出每一个技能：名字、描述、when-to-use 那一行、来源、服务它的提供者、是不是带条件、以及它声明的那些关于这次 run 的键。它不预览正文。

`disable` 把某个技能在这个部署里关掉，`conflicts` 报出任何一个被两个提供者同时给出的名字，带上赢家和被它遮住的那几行。

<a id="related-documentation"></a>
## 相关文档

- [钩子](hooks.zh.md)：一个技能钩子所依据的那些事件与那套钩子方言。
- [子 agent](subagent.zh.md)：为什么子 agent 默认拿不到技能工具。
- [包](../packages.zh.md)：技能这几个包住在哪。
