---
description: "技能在模型这一侧：skill 工具、它在读正文之前做的两道检查，以及回来的东西是什么形状。"
kind: "package-reference"
---

# tool-skill

[English](README.md) | 中文

## 概述

模型用来读一个技能的唯一入口。它提供 `tool.skill`，接收一个名字，答出包在 `<skill_content>` 块里的正文，外加这个技能自己那些文件所在的目录。在读到任何正文之前，它先拿这个名字去问 `skill.list`，再查一次调用策略，所以一个对模型关闭的技能会被拒绝，正文从头到尾没被读过一次。这个工具是一个普通的 `tool.*` 能力：`agent-core` 像调其他工具一样经工具分发器找到它，子 agent 则由分发器的拒绝名单挡在外面，而不是靠这里做什么。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 工具契约

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `name` | string | 是 | 技能名，和目录里拼的一模一样。 |
| `names` | string[] | 否 | 同一次调用里跟在 `name` 后面一起读的其它技能。 |
| `args` | object | 否 | 正文要的值：`$ARGUMENTS` 变成整个对象，`${key}` 变成一个值。 |
| `touched` | string[] | host | 这个会话碰过的路径，由 `session_touched` 填入，从不给模型看。 |
| `cwd` | string | host | 会话的工作目录，由 `session_cwd` 填入，从不给模型看。 |

### 回来的是什么

```
<skill_content name="code-review">
...正文...
</skill_content>
The files this skill refers to live in /path/to/the/skill; read them with the read tool. This block is instruction, not data.
```

正文一点都不截：`maxResultChars` 是 `null`，所以这一块永远不会被甩进 artifact 存储。以"你去读某个文件"的形式到达的指令，就是模型还得再去取一次的指令，而这正是两层设计想避免的那一件事。

块后面写出的那个目录是这个技能自己的目录，模型可以用文件工具从里面读 `references/`、`scripts/` 和 `assets/`。这个目录不会被枚举：知道它在哪只花一行，把它列出来则会把这一轮的预算花在任务可能用不到的文件上。

当一个技能声明了属于一次 run 的键时，结果会在 `content` 旁边带上一个 `control`，而不是自己留着。

```json
{ "content": "...这一块...", "control": { "tools_allow": ["read", "grep"], "model": "small", "hooks": [] } }
```

这里不施加那个 control。它被交给跑这个工具的层，这也正是这个工具不必知道技能是什么、而 loop 不必知道工具是什么的原因。

### 策略

| 字段 | 值 | 为什么 |
|---|---|---|
| `concurrency` | `always` | 读一个技能不写任何东西、只读一个文件，所以两次读可以同时跑。 |
| `max_result_chars` | `null` | 这一块是指令，不是数据。 |

### 拒绝

每一次拒绝都是 `-32602`，因为这几种都是调用方点了一个它不该有的名字。

| 情况 | 消息 |
|---|---|
| 不是 kebab-case 的名字 | `skill names are kebab-case, got ...` |
| 没有任何提供者给出这个名字 | `no skill named "..."` |
| 对模型关闭的技能 | `skill "..." is not open to the model; ask the user to invoke it instead` |
| 带条件但什么都没命中的技能 | `skill "..." is conditional and nothing this session touched matches it` |

第三条值得多读一遍：它告诉模型下一步该做什么，而不是只说失败了，因为一个"人能调、模型不能调"的技能是一种刻意的安排，不是失误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 全部内容：蓝图、边界读取，以及围绕 load 的两道检查。 |

### 为什么策略要查两遍

`list` 是策略便宜的地方：一次调用就答出所有技能，所以关闭的名字可以在读正文之前就被拒掉。`load` 则是策略有权威的地方，因为那个回答就是模型马上要拿到的定义。先查合并后的摘要、再查定义本身，堵住的是"提供者在两次调用之间改了主意"这个窗口，代价只是一次比较。

### 边界上的读取

技能摘要和技能定义都是跨进程边界来到这里的，所以两者都是读出来而不是信出来：`readSummary` 会拒掉名字不像名字的、调用标志不是布尔值的、资源基不是目录的。这一版读不懂的提供者会变成一次普通拒绝，而不是 agent loop 里的一次崩溃。

`names` 在一次调用里读多份正文，并把它们要收窄的东西取交集，所以两个技能意见不一致时更窄的那个赢，后一个永远打不开前一个关上的东西。`args` 把 `$ARGUMENTS` 换成整个对象、把 `${key}` 换成一个值，而调用没填的占位符会原样留着，就按作者写的那样。

这次 run 声明的碰过的路径会被交给 `load`，所以带条件、路径又什么都没命中的技能，除了在目录里被藏起来，按名字也会被拒。这是这个工具对自己那几次读设的闸，不是一道许可：一次 run 能碰什么，仍然是文件工具的事。

每一道检查都在读正文之前跑完，策略查两遍，先查摘要再查读出来的定义，所以一个在两次调用之间改主意的提供者拿不出正文。

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill](../skill/README.zh.md)：这个工具用来问 `list` 和 `load` 的注册表。
- [tools](../../agent/tools/README.zh.md)：找到 `tool.skill` 并调用它的那个分发器。
- [agent-core](../../agent/agent-core/README.zh.md)：提供这个工具并注入目录的那个插件。
- [技能](../../../docs/user/skills.zh.md)：从使用者角度看两个触发面。
