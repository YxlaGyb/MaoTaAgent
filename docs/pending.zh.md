# 未完成的工作

[English](pending.md) | 中文

v5 那一轮重写了技能链、hook 点和权限闸门，那份计划里还有四块没有落地。本页就是它们的待办清单：下面每一条都在 2026-09-22 对着代码核过，今天不在代码里，并写明了要改哪个文件。条目靠「做掉」离开本页，不靠改措辞；最后一条走时，这一页也跟着删掉。

`docs/CONVENTIONS.md` 不让未完成的工作进 README。本页是它唯一该在的地方。

## 目录

- [shell 与 PowerShell](#shell-与-powershell)
- [子 agent](#子-agent)
- [待办](#待办)
- [前端与启动](#前端与启动)
- [遗留](#遗留)

## shell 与 PowerShell

`packages/shell/` 今天做的是：一条命令开一个子进程，答一次。

- **流式**：命令跑的时候没有任何回调。`ShellRunRequest` 没有 `onChunk`（`packages/shell/shell/src/types.ts`），`runPwsh` 一直缓冲到最后（`packages/shell/pwsh-local/src/pwsh.ts`），所以想要实时输出的调用方没有路可走，走线上也没有——而 `call.stream` 本来就有（`packages/plugin-kit/src/plugin.ts`）。
- **`env` 与 `argv`**：请求只有 `command`、`workdir`、`timeout_ms`。既不能加环境变量，也不能不经过一层 shell 直接跑一个程序。
- **可复用的 shell**：没有 `shell.session`，所以每次运行都要重开一个 PowerShell 进程，长命令也没法启动后放着不管。
- **spill**：超过 `max_output_bytes` 的输出被丢掉，结果只说 `truncated`，没有指向剩余部分的路径。
- **一份预算**：`take()` 给 stdout 和 stderr 各自一份完整预算，一次运行可以返回配置上限的两倍。计划要求两者合起来算。
- **kill 阶梯**：超时只调一次 `child.kill()` 并报 `timed_out`。没有「先礼貌终止、再等待、最后强杀」的过程，所以无视第一次 kill 的命令会一直挂住这次运行；`ShellRunResult` 也没有 `forced`。
- **破坏性分类**：一条命令要不要审批，由工具里的 `RISKY` 列表决定（`packages/shell/tool-pwsh/src/approval.ts`），不走 `permission` 的 `rules`，所以部署方不发版就改不了。
- **`justification`**：工具没有「为什么要跑这条命令」的参数；审批请求带的是工具自己写的 `reason`，没有调用方写的东西。
- **`max_timeout_ms`**：provider 的 `timeout_ms` 只是默认值而不是上限，调用方传更大的值就不受限。
- **两条要写进 README 的事实**：没有沙箱；结果里的 `signal` 只是「这次 kill 是终止」的名字，不是 POSIX 信号。

## 子 agent

- **深度**：没有人在数委派层数，所以子 agent 可以无限再开子 agent。计划要 `max_depth`，默认 1、最多 3。
- **子 agent 的身份**：工具只回子 agent 最后那条消息，不给它跑在哪个 session，所以事后既看不了也接不上。
- **`resume`**：没有办法继续一个早先的子 agent。
- **`background`**：没有「丢出去就不管」的委派，结束也没有事件。
- **agent 定义文件**：`$MAOTA_HOME/agents/<name>.md` 没有被读；两种子 agent 是写死的。
- **`context: "fork"`**：子 agent 拿不到父会话历史。`packages/agent/agent-core/src/control.ts` 里技能的 `context: fork` 是另一回事，只是同名。
- **`output_schema`**：子 agent 用散文回答；没人校验这个回答，答不出结构也不会重问一次。
- **`child_timeout_ms`**：每个子 agent 没有时限。
- **一条要写进 README 的事实**：同时在跑的子 agent 上限是按进程算的。

## 待办

- **`op`**：`tool.todo_write` 整份替换计划。没有 create、update、get。
- **`depends_on`**：条目之间没有依赖边。
- **`in_progress`**：没有进行中条目的计数，同时有好几个在进行中时也不会提醒模型。
- **`todo.changed`**：计划变了没有任何事件发布，前端只能轮询。
- **计划落盘**：计划通过 `session.save_todos` 存。它自己的文件 `$MAOTA_HOME/plans/<session>.json` 不存在。
- **一条要写进 README 的事实**：验证提醒只是建议，不是闸门。

## 前端与启动

- **`serve --port` 与 `--host`**：两个选项都不存在（`apps/cli/src/args.ts`），端口只能来自 profile 配置，启动也没有自己的时限。
- **`maota session list|show|rm`**：CLI 只有 `serve`、`check` 和一次性提问（`apps/cli/src/index.ts`）。
- **`maota config get|set`**：没有这个命令，也没有可读写的 `$MAOTA_HOME/settings.toml`。
- **import 图**：`apps/cli/src/graph.ts` 认字面量的 `import "x"` 和 `import("x")`，认不出常量形式的。
- **hmr**：只监视给它的那几个 root，所以 `configKeys` 是 `["roots"]`（`packages/boot/hmr/src/index.ts`）：没有 `ignore`、没有 `debounce_ms`，root 还不存在时也不会退到最近的已存在祖先。
- **host**：处理函数抛错既不记日志也不退订；topic 模式里的 `*` 只匹配一段（`packages/plugin-kit/src/channel.ts`）；`shutdown` 等待没有时限（`packages/boot/host/src/index.ts`），所以内核卡住时 CLI 会一直挂着。
- **一条要写进 README 的事实**：插件行之间的顺序不承重，所以没有任何检查。

## 遗留

- `.tmp-maota-config`，一次用临时 `MAOTA_HOME` 跑 `maota check` 留下的，还在工作树里。
- 根 `check` 链上有 25 条命令。上面这些的 smoke 测试在等它们要演练的代码。