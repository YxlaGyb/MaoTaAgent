---
description: "permission 插件：按会话生效的策略档位、还在等回答的问题、四个结果词，以及把每次提问和它的决定配成对的审计文件。"
kind: "package-reference"
---

# permission

[English](README.md) | 中文

## 摘要

一个能力，`permission`，工具在做"该由用户决定"的事情之前调用它。它按会话与工作目录持有档位，套用 profile 配置的规则表，把问题停在那里等人回答，并用四个词之一作答，其中只有 `allowed-once` 是放行。回答可以被记住，此后同一个工具再被调用就由文件而不是由人来定。每一次提问都和它的决定配对写进审计文件，重启后依然在；档位与被记住的回答在变更时都留痕。注册以插件为单位，重启的前端替换的是自己那条注册。

## 目录

- [使用这个包](#使用这个包)
- [实现说明](#实现说明)
- [延伸阅读](#延伸阅读)

-----

<a id="使用这个包"></a>
## 使用这个包

### 配置

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `mode` | string | `ask` | 会话自己选档之前的回退档位。取 `ask`、`auto`、`full` 之一。 |
| `dir` | string | `$MAOTA_HOME/permissions` | 审计文件放在哪。一个工作目录一个目录，一个会话一个文件。 |
| `max_records` | integer | `500` | 一个文件保留多少条记录。保留最新的，且绝不把一次提问和它的决定拆开。 |
| `rules` | array | `[]` | `{ match, action }` 条目，按顺序读，第一个 `match` 命中工具名的条目做决定。`action` 取 `allow`、`deny` 或 `ask`。 |
| `remember` | boolean | `false` | 为 `allow` 的 `answer` 是只对这一问有效，还是对同一个工具之后每一次调用都有效。 |

### 方法

| 方法 | 参数 | 回答 |
|---|---|---|
| `policy` | `session_id`、`cwd` | `{ mode, grants }`。没有文件的会话按配置的档位作答，且没有任何记住的放行。 |
| `set_policy` | `session_id`、`cwd`、`mode` | `{ mode }`。不属于三档的 mode 报 `-32602`；把会话设成它已有的那一档不产生任何变化。 |
| `request` | `session_id`、`cwd`、`tool`、`call_id?`、`reason?`、`subagent?` | `{ outcome }`，取 `allowed-once`、`rejected`、`cancelled`、`unavailable` 之一。会话存储够得到时，所指会话从未发生过的 `call_id` 报 `-32602`。 |
| `answer` | `id`、`decision`、`remember?` | `{ settled: true }`。`decision` 取 `allow` 或 `deny`；迟到或未知的 `id` 报 `-32602`。`remember` 缺省取配置里的 `remember`。 |
| `forget` | `session_id`、`cwd`、`tool?` | `{ grants }`。撤掉一条被记住的回答；`tool` 缺席时撤掉全部。 |
| `pending` | `session_id?` | `{ requests }`：还在等的问题，每条带 `id`、`session_id`、`tool`、`at` 以及可选的 `call_id`、`reason` 与 `subagent`。 |
| `register_answerer` | 无 | `{ answerers }`。以 caller 标签为键，所以一个插件只占一条。 |
| `unregister_answerer` | 无 | `{ answerers }`。 |

### 事件

| 主题 | 载荷 |
|---|---|
| `permission.requested` | `{ id, session_id, tool, call_id?, reason?, subagent?, at }`。只在问题真的被停下来时才发布。 |
| `permission.settled` | `{ id, outcome, decided_by, at, subagent? }`。 |

两者都是尽力而为：漏掉一条的订阅方用 `pending` 和文件重建。

### 子代理的提问

子代理发起的调用是以父的身份到达闸门的：父的 `session_id`、派出这个子代理的那次调用的 id 作为 `call_id`、子代理真正调用的那个工具，以及一个 `subagent` 标签 `{ id, type?, description? }`。于是闸门答出来的一切都落在委派发生的地方：发布出去的问题带着这个标签，卡片就能出现在父会话那行 `task` 下面并写明是哪个子代理在问；`asked` 与 `decided` 两条记录也都留着它，所以重启之后审计读起来是同一回事。

这个标签是被带过来的，而不是被核对的，因为只有调用方知道自己在哪次运行里。它带来的 `call_id` 是另一回事：那个东西指名的是一次调用，所以会话存储够得到时，闸门会读会话，并拒绝一条没有任何消息携带的 `call_id`。没有可用 `id` 的对象以 `-32602` 拒绝；标签缺席就只是会话自己在问。

### 审计文件

| 字段 | 含义 |
|---|---|
| `schema_version` | `2`。 |
| `session_id`、`cwd` | 这个文件属于哪个会话，以及它是按哪个工作目录解析出来的。 |
| `mode` | 会话自己的选择；从未选过则为 `null`，此时套用配置的回退值。 |
| `grants` | 提问被以 `remember` 回答过的工具：其中之一的调用不再需要询问。 |
| `records` | 记录，从旧到新：`policy`、`asked`、`decided` 与 `grant`。由子代理发起的调用，其 `asked` 与 `decided` 带 `subagent` 标签，`policy` 永远不带。`grant` 是一条被记住的回答，被撤回时带 `revoked: true`。 |

### 依赖与配置

| 项 | 含义 |
|---|---|
| `provides permission` | 能力本身。它什么都不依赖：闸门是一片叶子，`session` 能力只在恰好存在时才读。 |
| `configKeys` | `mode`、`dir`、`max_records`、`rules`、`remember`。 |

-----

<a id="实现说明"></a>
## 实现说明

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件本体：各方法、等待注册表、审计追加、`selfCheck`。 |
| [`src/store.ts`](src/store.ts) | 文件模型：`encodeDir`、`read`、`write`、决策表、配对不变式，以及它校验的那个子代理标签。 |

### 只有一张决策表

`decide(mode, answerers, tool, rules, grants)` 就是全部策略，从最严到最松：`action` 为 `deny` 的规则直接拒绝，被记住的放行直接允许，`action` 为 `allow` 的规则允许，而 `action` 为 `ask` 的规则无论档位怎么说都要去问听得见的人。之后才轮到档位：`full` 与 `auto` 答 `allowed-once`，`decided_by` 分别是 `policy:full` 与 `policy:auto`；`ask` 且没有注册应答者时答 `unavailable`，原因是 `no-answerer`。凡是要问且有人可问的，都返回那个"不是答案"的词，由调用方停下来去问。因为策略只有一个函数，一个没想清楚的档位不可能悄悄变成一次放行，而一条要求问人的规则也不会被档位说服。

### 先发布问题，再去等

`request` 先追加 `asked` 记录并发布 `permission.requested`，然后才停在那里等。已经在听的应答者于是可以在调用方还没走到等待点时就回答，落在这个窗口里的回答不会丢。被停下的问题会挂上自己的中止监听，所以取消调用、或插件停机，都会把它结案为 `cancelled` 并写下配对的 `decided` 记录，而不是留下一条孤立的提问。

子代理送来的标签跟着问题走，而不是跟着应答者走，所以迟到的订阅方仍能在 `pending` 里看到它，而把提问与决定配起来的那条记录也留着它，闸门不必记住是哪个运行在问。

### 配对不变式

`pairingProblems` 是插件对自己产出做的检查：每条 `asked` 恰好配一条同 id 的 `decided`，没有 `asked` 的 `decided` 只在 `decided_by` 以 `policy:` 开头时合法。`trim` 保留最新的 `max_records` 条，并丢掉开头那条问题已被截掉的决定，于是截断之后不变式依然成立。

### 为什么写入不复用会话存储

原子写入是对 `packages/session/src/store.ts` 那个做法的复制（序列化到临时名，再改名覆盖），而不是 import 它。插件管自己的文件，而复制八行比让闸门依赖一个与它无关的包更划算。

六条事实界定了这道闸门。这里没有任何东西知道破坏性命令长什么样：运行命令的工具自己决定，闸门只负责把问题带过去。许可是 `allowed-once`，除非回答被记住了；被记住的回答覆盖该工具之后每一次调用，直到 `forget` 把它撤掉，这也正是它值得一问的原因。第一个回答胜出，而且每个已注册的回答者都可以回答每一个问题，所以这里没有仲裁。规则按配置顺序对工具名做匹配，调用本身的其他任何东西都不参与。注册项以调用方标签为键活在内存里，所以带着一个悬置问题重启的部署会把它按 `cancelled` 结清，而档位与被记住的回答是写下来的，能挺过重启。事件是尽力而为的：错过 `permission.requested` 的订阅者从 `pending` 学到这个问题，所以建立在事件流之上的东西仍然要做对账。

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [权限设计](../../../docs/user/permission.zh.md)：闸门落在哪，以及它刻意不做什么。
- [tool-pwsh](../../shell/tool-pwsh/README.zh.md)：发起询问的那个工具。
- [interaction 包组](../README.zh.md)：发问与决断如何分工。
