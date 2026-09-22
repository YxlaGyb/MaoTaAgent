# 子代理

[English](subagent.md) | 中文

MaoTa 一次处理一段对话，而对话是个不适合一次装下所有东西的地方：会用完的上下文、拆开更好读的工作，以及只想要结论的读者。子代理就是这件事的答案：另一次运行，自带上下文，它对这段对话的全部贡献就是它结束时那条消息。本文持有这条接缝：子代理是什么、它能做什么、它对外戴谁的身份、界面可以展示什么。

## 目录

- [委派的两半](#the-two-sides-of-a-delegation)
- [两种子代理](#the-two-kinds-of-subagent)
- [子运行](#the-child-run)
- [工具面：两道过滤](#the-tool-surface-enforced-twice)
- [身份](#identity)
- [父链](#the-parent-link)
- [事件与前端](#the-events-and-the-front-ends)
- [本文不覆盖的部分](#what-this-does-not-cover)
- [进一步探索](#related-documentation)

-----

<a id="the-two-sides-of-a-delegation"></a>
## 委派的两半

两个包各持一半，彼此不互相 import。

`@maota/tool-subagent` 持有请求侧：模型调用的 `task` 工具、它可以要的两种子代理、每种拿到的工具面与系统提示词、同时在跑的数量上限，以及答案的形态。`@maota/agent-core` 持有运行侧：`agent.loop` 长出了子运行模式（`origin`、`system`、`tools_allow`、`tools_deny`、`max_steps`），正是这个模式让子运行成其为子运行。

这样分让静态依赖图保持无环。`tool-subagent` 依赖 `agent.loop` 的 `^1.3` 并调用它；`agent-core` 对委派工具一无所知，它像发现别的工具一样，通过 `tools.list` 发现它。没装配 `tool-subagent` 的部署就是没有 `task` 工具，而装了它却没装 `agent-core` 的部署会在 `requires` 上失败。

<a id="the-two-kinds-of-subagent"></a>
## 两种子代理

| `subagent_type` | 工具 | 系统提示词 | 用来做 |
|---|---|---|---|
| `general` | 整个工具池，减去 `task`，再减去 `child_tools_deny` | `general_system` | 干活：查、改、跑命令、回报。 |
| `explore` | `explore_tools`，同样减去那些拒绝项 | `explore_system` | 看：读一读那儿有什么，并用能证明结论的路径作答。 |

`explore` 是把只读这个承诺变成结构而非提示词口头的那个：它的工具清单是固定白名单，没有能把它说动的空间。两种都拒绝 `task`，无论部署在 `child_tools_deny` 里写什么，因为一层委派就是这一版的全部形状。

两种都不提供 `skill` 工具，也都不会收到技能目录，这正是 `child_tools_deny` 的默认值。子代理有自己的上下文要花，目录会在活开始之前就把它花掉。

<a id="the-child-run"></a>
## 子运行

子运行是 `agent.loop` 的一次运行，所以它复用循环、提供方、工具分派器与会话存储。它改的是这些：

| 性质 | 普通运行 | 子运行 |
|---|---|---|
| 历史 | 从会话文档载入。 | 永远为空。唯一的输入是那条 prompt。 |
| 系统提示词 | 配置里的那份、工作目录与审批策略，另外技能目录会作为一条自成消息送达。 | 子代理自己那份、工作目录与审批策略，且没有目录消息。 |
| 标题 | 第一条用户消息。 | 这次调用的 `description`。 |
| 步数上限 | `max_steps`。 | 这次调用拿到的 `child_max_steps`。 |
| 模型与思考档位 | 从调用方选的档位读出。 | 继承父运行：父运行开始时把它们公布了。 |
| 提示词接缝 | 会触发 `UserPromptSubmit`，结束时触发 `Stop`。 | 两者都不触发：子代理没有用户轮次，也不接受继续指令。 |
| 钩子 | `PreToolUse`、`PostToolUse`，带会话自己的身份。 | 同样的钩子，带父会话与父调用 id，外加一个 `subagent` 字段。 |

模型与档位的继承值得一提：子代理向提供方要的是父运行用的同一个模型，在 `medium` 档位下启动的子代理不会悄悄跑在缺省模型上。这次查表是一张按会话 id 索引的进程级表，父运行开始时写入、结束时清除；查不到父会话的子代理退回「拿到工具、不指定模型」的那一档。

子代理用工具做的一切，都是它自己会话里的一次普通工具调用。没有一样被复制进父会话：父会话的历史里只有那次 `task` 调用和它的唯一结果，这就是全部痕迹。

<a id="the-tool-surface-enforced-twice"></a>
## 工具面：两道过滤

子代理的工具在两处被过滤，两处都算数。

模型看见的清单被过滤过，所以在一个拒绝 `write` 的部署里，`general` 子代理根本不会被告知这个工具存在。而 pre-tool 接缝会最先检查工具面，先于任何别的意见，于是模型仍然臆想出的一次调用，会作为被拦的结果回来，内容是 `the <name> tool is not available to this subagent`。正是这第二道把承诺变成了性质：不管模型有没有见过这个工具，被提示词注入的或幻觉出来的调用都到不了工具面之外。

工具面由 `agent-core` 施加到子代理上，而不是由委派工具施加，因为运行才是唯一能拦住一次调用的地方。

<a id="identity"></a>
## 身份

子代理内部的一次工具调用，对整个系统说话时用的是父会话的那次调用，另附一条说明真正在问的是谁。具体到子代理在用户正看着 `task` 那一行时发出的一次 `pwsh` 调用：

| 字段 | 值 |
|---|---|
| `session_id` | 父会话。 |
| `call_id` | 父的 `task` 调用 id。 |
| `tool` | 子代理实际调用的工具（`pwsh`）。 |
| `subagent` | 子代理的 `{ id, type, description }`。 |

`permission/request` 接收这个可选的 `subagent`，审计文件把它记在 `asked` 与 `decided` 两条记录上，两个发布的事件也带着它。web 插件把它转发到审批卡上，所以子代理问的问题会出现在父的 `task` 那一行下面，并写明是哪个子代理在问。`PreToolUse` 与 `PostToolUse` 的钩子载荷带父身份与同一个字段。

这套办法的意义在于：界面要摆放任何东西（一次工具调用、一张审批卡、子代理的工具流水），只需要一个锚点 `call_id`。这个锚点本来就已经存在于父自己的调用上，所以子代理不需要第二套摆放方式。

<a id="the-parent-link"></a>
## 父链

`session` 能力现在是 `1.2.0`，其文档 schema 是第 3 版。子代理的文档与父的放在同一个目录里，因为子代理拿到的就是父的工作目录，且从不写到它外面。它多带一个字段：

```json
{
  "parent": {
    "id": "the parent session id",
    "cwd": "the parent working directory",
    "call_id": "the id of the task call",
    "type": "explore",
    "description": "look at the loader"
  }
}
```

这个字段改变三处答案。`session.list` 不返回带链的文档，所以侧栏与对话搜索永远看不到子代理。`session.children { id, cwd }` 返回某个会话启动过的子代理，按创建顺序。而两种答案里的每一条摘要都带着这条链，于是重开旧会话的页面不用加载任何东西，就能把入口挂回正确的调用之下。

读第 1、2 版写下的文档照旧能读：读的时候升级，没有链，下一次写入就存第 3 版。

<a id="the-events-and-the-front-ends"></a>
## 事件与前端

子运行期间，内核总线上会（尽力）发布五个主题：

| 主题 | 载荷（除那五个身份字段之外） |
|---|---|
| `agent.subagent.started` | 无 |
| `agent.subagent.step` | `step` |
| `agent.subagent.tool_call` | `id`、`tool`、`args` |
| `agent.subagent.tool_result` | `id`、`tool`、`ok`、`output` |
| `agent.subagent.finished` | `steps`、`reason`、`ok` |

每个载荷还带 `subagent_id`、`parent_session_id`、`parent_call_id`、`type` 与 `description`。子代理别的什么都不发布：它的文本与推理只在自己那次运行里流，不广播出去，因为一个已经在显示父会话逐字的页面，用不上子代理的逐字。

这些事件是实时视图跟随子代理的方式，同时也是丢掉了也不花代价的那一部分。子代理贡献出来的东西是 `task` 调用的结果，它走父自己的流回来；事件只是说明读者在看的时候发生了什么。漏掉事件的前端显示得更少，但显示的内容是对的。

web 插件订阅 `agent.subagent.*`，把每一条转成带父会话当前轮次 `turn_id` 的 `subagent.<name>` 事件下发，因为那是页面唯一使用的键。在该会话没有轮次在跑时到达的事件会被丢掉。页面把子代理渲染在 `call_id` 相符的那条工具行下面，显示类型、标签、状态、步数与它调过的工具，并按需加载子代理自己的会话；重开旧会话时从 `session.children` 还原同一个入口。

CLI 订阅同样的主题并缩进打印，于是终端能看见子代理的调用，而父自己的输出形态不变。

<a id="what-this-does-not-cover"></a>
## 本文不覆盖的部分

- **不等在后台跑。** 一次 `task` 调用一直阻塞到子代理停下。没有可轮询的句柄，也无法先开一个、稍后再回来。
- **不能续聊。** 子会话 id 不会交回给模型，所以后面的轮次无法接着那段对话。
- **没有 agent 定义文件。** 提示词来自插件配置，而不是每个 agent 一个文件。
- **不 fork。** 每个子代理从空开始，父会话的对话不会被复制。
- **没有结构化输出。** 结果就是文本。
- **没有自己的超时。** 子代理的边界是它的步数上限和父轮次的取消。
- **没有进程外后端。** 子代理与它的父会话跑在同一个插件进程里，没有远端执行者。

<a id="related-documentation"></a>
## 进一步探索

- [subagent 包组](../../packages/subagent/README.zh.md)：委派工具以及它如何被装配。
- [tool-subagent](../../packages/subagent/tool-subagent/README.zh.md)：工具的参数、配置、拒绝与结果形态。
- [agent-core](../../packages/agent/agent-core/README.zh.md)：子运行由什么构成。
- [session](../../packages/session/README.zh.md)：那份文档与父链。
- [权限闸门](permission.zh.md)：`subagent` 字段落进的审计文件与事件。
- [钩子点](hooks.zh.md)：子代理的调用经过的两条接缝。
- [架构](../architecture.zh.md)：这一切在整个系统中的位置。
