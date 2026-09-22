---
description: "面向插件、UI 与编排器的 Agent 句柄、实时注册表、进程本地发起方作用域，以及 agent/* 与 agent.subagent.* 事件词汇。"
kind: "package-reference"
---

# agent

[English](README.md) | 中文

## 概述

`agent` 是前端真正对话的那个插件。一次 `run` 调用先从 `session` 取出历史，在前面拼上由基础提示词与工作目录构成的系统提示词，在技能目录与历史里最后一条注记不同时追加一条目录注记，跑完模型与工具的循环，再把这一轮写回去。它提供 `agent.loop` 能力，方法有 `run` 与 `info`。循环本身在 [`../agent-loop`](../agent-loop/README.zh.md)；本目录负责它周边的配置、提示词、会话记账与工具装配，挂上引擎时它也是循环与 hook 之间的桥。profile 配置拉起的是这个包：由 [`src/index.ts`](src/index.ts) 构建出的 `lib/index.js`。

有一个输入会把这轮 `run` 变成本包认识的另一种轮次：给出 `origin` 就成了一次子运行，也就是子代理的构成。子运行从一段空对话开始，沿用把它派出来的那段会话的身份，按自己的一套工具面与系统提示词作答，并把进展发布到内核总线上。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

前端通过 `agent.loop` 能力找到这个插件。

### 方法

| 方法 | 回答 |
|---|---|
| `run` | 一条流。它要求 `meta.stream`，不带这个元信息的调用会被拒绝。 |
| `info` | `{ levels, thinking }`：支持的思考档位，以及已配置的表。 |

### `run` 的输入

| 输入 | 含义 |
|---|---|
| `session_id` | 这一轮属于哪段已存会话。缺省是 `default`。 |
| `cwd` | 会话的工作目录。缺失或为空表示这段会话没有工作目录。 |
| `input` | 用户的消息。空串表示就按已存历史跑一轮。 |
| `thinking` | 档位：`off`、`low`、`medium`、`high`。缺省是 `off`。 |
| `origin` | 这次运行是子代理时给出：`{ parent_session_id, parent_call_id?, type?, description? }`。不写就是普通的一轮。 |
| `system` | 覆盖本轮配置里的基础提示词。工作目录与审批策略照旧追加，技能目录永不追加。 |
| `tools_allow` | 本轮可用的工具名。不写就是整个工具池。 |
| `tools_deny` | 要从池里去掉的工具名，在 `tools_allow` 之后生效。 |
| `max_steps` | 本轮最多发起几次模型调用，覆盖配置里的 `max_steps`。 |
| `depth` | 这次运行处在第几层委派。不写时，子运行比拥有它父会话的那次运行深一层，顶层轮次是 0。比 `max_depth` 更深的运行会立刻以 `refused` 结束。 |

### 子运行

子运行与普通轮次有八处不同，每一处调用方都看得见：

| 属性 | 普通轮次 | 子运行 |
|---|---|---|
| 历史 | 从会话文档里读出来。 | 空。唯一的输入是 `input`。 |
| 系统提示词 | 配置的基础提示词、工作目录与策略，另加一条自成消息的技能目录注记。 | `system`、工作目录与策略，且没有目录注记。 |
| 工具 | 工具池，挂了那一行时 `skill` 已经在里面。 | 工具池经 `tools_allow`、`tools_deny` 以及子运行启动时的那份拒绝列表过滤。 |
| 写入的会话 | 本轮自己的会话，标题取自第一条用户消息。 | 自己的一份文档，带父链，标题取自 `description`。 |
| 模型与档位 | `thinking` 点名的那个。 | 父运行的，来自本插件在父运行期间按会话维护的那张表。 |
| 提示词点 | 这一轮自己的点都会触发：任何东西被写下之前的 `UserPromptSubmit`、模型不再要求更多调用时的 `Stop`，以及环绕整次 run 的 `SessionStart`、`PreModel`、`PostModel`、`PreCompact`、`Notification` 与 `SessionEnd`。 | `UserPromptSubmit` 与 `Stop` 从不触发，其余的点都带 `subagent: true`。 |
| 工具 hook | 会话自己的身份。 | 父的 `session_id` 与 `call_id`，外加一个 `subagent` 字段。 |
| 对外汇报 | 只走调用方的流。 | 调用方的流，外加总线上的 `agent.subagent.*`。 |

工具面故意在两处过滤：子运行的清单被过滤过，模型看不到自己不能用的名字；pre-tool 接缝又把它之外的一切都拒掉，所以模型编出来的名字只会以拒绝的形式回来，而不会真的跑起来。子运行的调用、提问与 hook 载荷都带父的 `session_id` 与 `call_id`，前端正是靠这一点把子代理的活挂到派出它的那行工具下面。

`origin` 若不是对象、或缺少 `parent_session_id`，以 `-32602` 拒绝；`system` 不是字符串、`tools_allow` 或 `tools_deny` 不是字符串清单、`max_steps` 不是正整数、`depth` 不是非负整数，同样拒绝。只写父会话的 `origin` 得到的类型是 `general`，没有 `parent_call_id`，描述为空。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_steps` | `8` | 一轮最多发起几次模型调用。 |
| `max_parallel_tools` | `4` | 一个批次里最多同时跑几个安全工具调用。 |
| `compact_after_chars` | `120000` | 一轮将要送出的文本超过这个数时，比最新 `compact_keep_messages` 条更早的消息会被折成一条注记。 |
| `compact_keep_messages` | `12` | 最新的多少条消息保持原样。 |
| `max_depth` | `3` | 一次运行最多能有多深，再深就被拒绝。 |
| `system` | 随包提供的编码助手提示词 | 基础系统提示词。 |
| `thinking` | `{}` | 每个档位的 `model` 与 `tools`。档位可以只写模型名，也可以写成表。 |

未知的档位名会在调用 `run` 时以 `-32602` 拒绝；`plugins.agent-core.config` 里多余的键由 `pnpm check:config` 点名。

### 事件

`run` 会把循环自己的事件、每 10 秒一条 `tick`，以及收尾的 `done` 推出去。

| 事件 | 载荷 | 含义 |
|---|---|---|
| `tick` | 无 | 这一轮还活着。 |
| `done` | `{ steps, text, reason }` | 这一轮结束了。`reason` 取 `completed`、`aborted`、`max_steps`、`refused` 或 `stopped`；`refused` 是本插件自己拒绝了提示词，此时 `steps` 为 0。 |

子运行不往这条流里加任何东西。它改为把进展发布到内核总线上，于是看的人能跟上一个子代理，而父的流形状不变：

| 主题 | 五个身份字段之外的载荷 |
|---|---|
| `agent.subagent.started` | 无 |
| `agent.subagent.step` | `step` |
| `agent.subagent.tool_call` | `id`、`tool`、`args` |
| `agent.subagent.tool_result` | `id`、`tool`、`ok`、`output` |
| `agent.subagent.finished` | `steps`、`reason`、`ok` |

每条载荷都带 `subagent_id`、`parent_session_id`、`parent_call_id`、`type` 与 `description`。子代理说过什么、想过什么都不发布：它的文本属于它自己的会话，调用方要的答案以那次调用的结果形式回来。

### 工具

所有工具都来自 `tools`，`skill` 工具也一样，因为这里没有任何东西按名字认得某个工具。声明了宿主参数的工具会在调用之前拿到那个值，除非模型自己给了这个参数；这些参数都会从交给模型看的 spec 里剥掉。安全与否经 `tools.classify` 询问。带 `control` 块的工具结果会在 post 工具接缝处被施加：收窄工具面、为本轮余下部分换掉模型、为本轮余下部分注册 hook，或者把一段正文当作子回合跑掉、只把它的最终文本作为这次调用的结果。

来源共四种：`session_cwd`、`session_id`、`call_id` 与 `subagent`，于是工具知道自己在服务哪段会话、正在跑哪次调用、是谁在问，而模型冒充不了其中任何一个。子运行里注入的会话与调用 id 仍是父的，`subagent` 带着子代理自己的 id、类型与描述；声明了这第四种来源的工具会被告知是哪个子代理在问，其余工具的表现和从前一样。

`permission` 能力在场时，每轮读一次它给这段会话的策略并写进系统提示词，好让模型知道"被拒绝"是什么意思，而不是反复重试一条没人会批准的命令。没有这个能力时提示词对审批只字不提，而那些本该发问的工具会把这份缺席读成"会问"的那一档。

### Hook

`hooks` 能力在场时，这一轮会在 `hook-protocol` 点名的每一个点上交给 hook：组装消息之前的 `UserPromptSubmit`；run 获准开始之后的 `SessionStart`；每次模型调用前后带 `ok` 的 `PreModel` 与 `PostModel`；只在真要折叠时才有的 `PreCompact`；循环的两条工具接缝 `PreToolUse`（调用被分类之前）与 `PostToolUse`（一次调用落定之后）；一次委派前后的 `SubagentStart` 与 `SubagentStop`；一次 run 因为模型没机会开口的原因停下时的 `Notification`；模型不再要求任何工具调用时的 `Stop`；以及无论怎么结束都会有的 `SessionEnd`。本文件是唯一同时认识两套词汇的地方：它每个点调用一次 `hooks.trigger`，把回答映射成循环声明过的决策，所以循环听不到 hook 的名字，hook 包也看不到循环的类型。`ask` 会被转成对审批层的一次提问，而给出 `args` 或 `output` 的 hook 会替换这次调用运行时的参数、或模型被告知它返回了什么。任何一个点上贡献的 context 都会变成这一轮里的一条 `hook:<name>` 消息，所以循环没有接缝的那个点照样被模型听见；在最末尾才触发的点，则被下一轮听见。被拒绝的提示词是唯一什么都不写、不调模型、直接以 `done` 收尾并报出 `refused`（`steps` 为 0）的路径。这个能力是可选的：没有引擎的部署就等于没有 hook，起跑时记一行日志。

子运行会走到这些点里的每一个，只有两个除外：`UserPromptSubmit` 与 `Stop` 对子运行不触发，因为子代理没有自己的用户回合，也不接受继续指令。它的调用带父的 `session_id` 与 `call_id`，以及一个指名子代理的 `subagent` 字段；会话、模型与折叠这几种点带的是 `subagent: true`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 定义：配置、`requires`、`run`、`info`、hook 桥与 `selfCheck` |
| [`src/catalog.ts`](src/catalog.ts) | 技能目录注记：什么时候追加一条，以及它如何与上一条比较 |
| [`src/compact.ts`](src/compact.ts) | 把长历史折成一条注记，以及步数上限留下的那条注记 |
| [`src/control.ts`](src/control.ts) | `readRunControl` 与 `narrow`：工具结果可能带的 `control` 块 |
| [`src/prompt.ts`](src/prompt.ts) | `systemPrompt`：基础提示词与工作目录 |
| [`src/tools.ts`](src/tools.ts) | `readToolList`、`stripHostArgs`，以及支持各宿主来源的 `injectHostArgs` |

### 一轮的过程

`run` 先列出工具，取回已存会话，把新输入追加进去（非空时），在目录与历史里最后一条注记不同时把目录注记追加进去，把超过 `compact_after_chars` 的历史折起来，并在第一次模型调用之前就把这份历史存下去，所以中途死掉的一轮也会在会话里留下记录。折叠会把比最新 `compact_keep_messages` 条更早的消息换一条注记，它的 source 是 `{ kind: "compact", folded }`，由一次非流式的 `chat` 调用写成；写不出摘要时就原样保留历史，而不是丢掉这一轮。接着它拼出一个消息数组，系统提示词在最前、历史在后，然后跑循环。循环返回后，去掉系统提示词的同一份数组会连同这一轮的标题再存一次。跑到 `max_steps` 的一轮会把这件事写成注记存下来，所以下一轮是接着做而不是从头开始；一次彻底失败的模型调用，在 gateway 用尽 `@maota/api` 负责的重试之后，会以 `model_error` 结束这次运行，而这一轮已经有的东西仍然被存下来。

在读取会话之前，提示词就先交给 hook 过一遍，那里被拒绝时这一轮什么都不存，也不调模型。hook 贡献的文本会以 `name` 为 `hook:<name>` 的 user 消息进入数组：提示词的排在历史之后、第一步之前，工具点的紧跟在它所对应的结果之后。

取消请求会中止正在进行的模型调用与工具调用，会话保留已经追加的部分。除循环自己的接缝之外，这个插件还会环绕这次 run 发出 `hook-protocol` 的事件：run 获准开始之后的 `SessionStart`、无论怎么结束的 `SessionEnd`、每次模型调用前后带 `ok` 的 `PreModel` 与 `PostModel`、只在真要折叠时才有的 `PreCompact`、一次委派前后的 `SubagentStart` 与 `SubagentStop`，以及一次 run 因为模型没机会开口的原因停下时的 `Notification`。它的流里还多一样循环不知道的东西：一轮运行期间每 10 秒一条 `tick`。

子运行走的是同一条路径，只是有四处不同：它不读历史、也不收目录注记；它写入自己的一份会话文档，带父链，标题取描述；它在运行前后发布 `agent.subagent.*` 主题；它的模型与思考档位取自父运行在进程级表里的那条记录，父运行开始时写入、结束时清掉。父不在那张表里的子运行退回“给工具、不点名模型”的那一档，和不带档位的一轮是同一种退法。

### 配置检查

`selfCheck` 覆盖本目录的纯函数部分：档位读取、标题截断、宿主参数的注入与剥离、`readToolList`，以及两次脚本化运行，一次必须以 `completed` 结束，一次必须以 `max_steps` 结束。hook 桥也在那里被检查：各个映射只留下对应接缝用得上的字段、空回答算没有意见、post 工具拒绝会结束本轮并带上理由、替换参数与替换输出会被透传、`ask` 会变成给审批层的一个问题，引擎缺席或调用失败都返回空回答。子运行同样有脚本：它必须不读历史地起跑，列出过滤后的工具面且不含 `skill`，面外的工具仍被拒，落盘的文档带父链且标题取描述，五个主题都带父的身份发布，模型取自父那张表。control 通道同样有脚本：一个 `control` 块会收窄工具面、换掉模型并注册 hook，而那些 hook 会在 run 结束时被撤回。折叠也有脚本：超过预算的历史会被存成一条注记、最新的几条保持原样；跑到上限的一轮会存下说明这件事的注记；抛错的模型调用会以 `model_error` 结束运行且这一轮仍被保存；比 `max_depth` 更深的运行会在列出任何工具之前被拒绝。任何一处走样都会让 `--check` 失败，所以 `pnpm check:plugins` 不用内核、不用模型就能抓到。

三条事实界定了这个插件。它从不挑选模型：思考等级给出一个名字，映射表在 gateway 手里。hook 可以拒绝一次调用、用 `ask` 把问题交给审批层、替换这次调用运行时的参数与模型被告知它返回了什么，并为回合添加文本；再往外收窄工具面与模型的，是 run 级的 `control` 块。回合在开始之前就被保存，所以一个被打断的回合会把尾部那条用户消息留在会话里。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-loop](../agent-loop/README.zh.md)：这个插件跑的循环引擎。
- [agent 包](../README.zh.md)：插件与循环怎么分工。
- [packages 包组](../../README.zh.md)：插件树，以及哪个插件持有哪个能力。
- [maota CLI](../../../apps/cli/README.zh.md)：驱动 `agent.loop` 的前端。
