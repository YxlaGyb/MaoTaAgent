# 系统提示词

[English](system-prompt.md) | 中文

每一轮对话都以一条模型在对话之前先读到的消息开场：它是谁、在哪儿干活、什么可以不问就做。这条消息不是循环写出来的。它归一个插件所有，循环只交出本轮已知的事实，而两者不会漂移，因为提示词陈述的正是循环依此行事的东西。本文档管的就是这条提示词：它的段落、它的变量、它的作用域，以及部署方如何改变它说的话。

## 目录

- [提示词从哪来](#where-the-prompt-comes-from)
- [始终在场的段落](#the-sections-that-always-ship)
- [改人设](#changing-the-persona)
- [注册一个段落](#registering-a-section)
- [变量与本轮的事实](#variables-and-the-facts-of-a-turn)
- [两层作用域](#the-two-scopes)
- [本文不覆盖的部分](#what-this-does-not-cover)
- [相关文档](#related-documentation)

-----

<a id="where-the-prompt-comes-from"></a>
## 提示词从哪来

`system-prompt` 插件提供同名的能力与四个方法。`agent-core` 每轮调用一次 `assemble`，带上会话 id、工作目录、它刚读到的审批模式，以及子 agent 启动时被给的人设。回来的是一段字符串，外加参与组装的段落清单。

harness 里没有别的地方在拼提示词文本。想对模型说点什么的插件去注册一个段落，而不是自己拼字符串塞进一条消息，循环则原样发送组装的结果。

<a id="the-sections-that-always-ship"></a>
## 始终在场的段落

| 段落 | 顺序 | 说的是什么 |
|---|---|---|
| `harness` | `-1000` | 一行点名 harness 与平台。 |
| `persona` | `0` | 部署方要求模型怎么干活、怎么回答。 |
| `working-directory` | `900` | 本轮干活所在的目录。 |
| `approval` | `1000` | 当前审批模式对一条被标记的命令意味着什么。 |

空段落会被丢掉，而不是留下一个空白段，所以既没有工作目录、又没有权限层的部署读到的是少一段，而不是两段什么都没有的话。

<a id="changing-the-persona"></a>
## 改人设

`persona` 是部署方通常唯一要改的段落。它有自己的配置键，所以一个 profile 在机器层里声明自己的口吻，而不是改代码：

```toml
[plugins.system-prompt.config]
persona = "Answer in short paragraphs and name the file you changed."
```

人设永不插值，所以里面带花括号也原样通过。用自己的人设启动的子 agent 只在它这一轮替换人设，其余段落照旧：子 agent 仍然知道自己在哪里、可以做什么。

<a id="registering-a-section"></a>
## 注册一个段落

有话要补的插件调用 `register`，给出名字、文本，可选地给出顺序、作用域，以及文本是否插值。文本也可以是本轮事实的函数，段落正是靠这一点在不同会话里说不同的话，或者干脆什么都不说。

同一作用域里名字已被占用会被拒绝，所以两个插件无法悄悄互相覆盖。`unregister` 按名字移除一个段落，`release` 一次丢掉某个作用域注册的全部内容，这正是会话结束时做的事。global 作用域不能被释放。

<a id="variables-and-the-facts-of-a-turn"></a>
## 变量与本轮的事实

段落可以引用变量，写成 `{{name}}`，组装时会被填上。提示词自带两个：`session_id` 与 `cwd`。插件还能注册更多，值可以是固定的，也可以是本轮事实的函数。

段落引用了没人注册的变量会中止组装、让本轮失败，而不是把本该是事实的地方留个空位交给模型。这是有意的：一段带着 `{{cwd}}` 的提示词是个 bug，而模型会试着绕过它去猜。

缺失的事实不是空字符串。"工作目录为空"和"没有工作目录"是两种不同的陈述，只有后者才会把那句话整个省掉。

<a id="the-two-scopes"></a>
## 两层作用域

段落要么属于 `global`，要么属于某一个会话。组装时两层合并，同名时会话段落遮蔽 global 段落，所以插件可以到处注册一条规则，而某次会话可以为它自己换掉那一条。释放会话作用域会带走它的段落与变量，global 的则不动。

同一作用域内，段落先按顺序再按名字排序。注册的先后永远不会体现在结果里，所以两个都想抢最后一句话的插件，必须用数字说话，而不是靠运气。

<a id="what-this-does-not-cover"></a>
## 本文不覆盖的部分

- 提示词是对话开头的一条消息。中途到达的上下文，例如技能目录，走它自己的消息，不属于这次组装。
- 工具 schema 也不属于组装：它们由 tools 能力在提示词旁边一起交给模型。
- 提示词缓存不在这里安排。同样的事实产出同样的字符串，这正是缓存需要的，但并没有为某个 provider 标出边界。

<a id="related-documentation"></a>
## 相关文档

- [权限闸门](permission.zh.md)：回答本条提示词所陈述的审批模式的那个插件。
- [子 agent](subagent.zh.md)：替换人设、保留其余段落的那些运行。
- [架构](../architecture.zh.md)：组件地图与启动链路。
- [system-prompt 包](../../packages/agent/system-prompt/README.zh.md)：方法、配置键与源码地图。
