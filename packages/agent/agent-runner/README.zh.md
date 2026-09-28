---
description: "agent-runner 包：所有 turn 的统一入口、session 串行、队列优先级、唤醒预算，以及系统消息投递。"
kind: "package-reference"
---

# agent-runner

[English](README.md) | 中文

## 概述

`agent.runner` 是所有 turn 的唯一入口。它保证每个 session 同时只有一个 turn，把系统工作排在用户输入之后，应用连续唤醒预算，并为计划任务发布 `agent.turn.*` 事件。后台任务完成通知和 cron 提醒走同一条投递路径。

前端不直接驱动 `agent.loop`。CLI、Web、jobs 与 schedule 都先调用 `agent.runner`；runner 负责排队与串行，再调用 `agent.loop` 执行模型与工具循环。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)

-----

<a id="使用本包"></a>
## 使用本包

### 四个方法

| 方法 | 参数 | 回答 |
|---|---|---|
| `send` | `{ session_id, cwd, input, thinking?, source }` | 一条流。只接受 `source.kind = "user"`。 |
| `deliver` | `{ session_id, cwd, input, source, wake?, wait? }` | `{ turn_id, state }`，或在 `wait: true` 时返回最终 turn 结果。接受 job 与 schedule 来源。 |
| `cancel` | `{ turn_id }` | `{ cancelled: true }`，排队中与运行中的 turn 都可以取消。 |
| `status` | `{ session_id }` | `{ running, queued, deferred, wake_budget }`。 |

### 来源

- `{ kind: "user" }`：用户输入，优先级最高。
- `{ kind: "job", id }`：后台任务完成通知，优先级居中。
- `{ kind: "schedule", id, occurrence, mode, title }`：提醒或计划结果，优先级最低。

来源会随用户消息写入 session，因此前端可以区分聊天与系统投递。

### 事件

| 事件 | 含义 |
|---|---|
| `agent.turn.queued` | turn 已进入队列。 |
| `agent.turn.start` | turn 开始运行。 |
| `agent.turn.text` | 模型输出文本。 |
| `agent.turn.reasoning` | 模型输出推理文本。 |
| `agent.turn.tool_call` | 工具调用开始。 |
| `agent.turn.tool_result` | 工具调用结束。 |
| `agent.turn.done` | turn 正常完成。 |
| `agent.turn.error` | turn 以错误结束。 |

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_parallel_turns` | `2` | 所有 session 最多同时运行几个 turn。 |
| `max_system_turns` | `1` | 所有 session 最多同时运行几个系统 turn。 |
| `max_consecutive_wakes` | `3` | 一个 session 在新用户输入前最多连续被系统唤醒几次。 |

### 依赖

| 能力 | 必需 | 用途 |
|---|---|---|
| `agent.loop` | 是 | 执行模型与工具循环。 |
| `jobs` | 否 | 提供后台任务完成事件。 |
| `permission` | 否 | 设置 fresh session 的任务级权限策略。 |

-----

<a id="理解实现"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | capability 定义、配置、方法、事件订阅和自检入口。 |
| [`src/queue.ts`](src/queue.ts) | session 队列、优先级、全局并发、唤醒预算和 deferred inbox。 |
| [`src/run.ts`](src/run.ts) | 把 turn 转为 `agent.loop.run`，转发流事件并生成最终结果。 |
| [`src/sources.ts`](src/sources.ts) | 来源解析，以及 job 与 schedule 通知文本。 |
| [`src/types.ts`](src/types.ts) | TurnInput、TurnResult、TurnEvent 与来源类型。 |

### 串行与优先级

同一个 session 同时最多运行一个 turn。不同 session 可以并行，直到达到全局上限。

优先级固定为：

1. 用户 turn。
2. job 完成通知。
3. schedule 提醒。

同优先级按先进先出执行。运行中的 turn 不会被后来的用户输入抢占。

### 忙碌与空闲

用户 turn 运行时到达的 job 或 schedule 消息会等待当前 turn 结束，不会塞进当前模型步骤。

空闲 session 收到系统消息且唤醒预算可用时，会启动 follow-up turn。

### 唤醒预算

每个 session 独立维护连续唤醒次数，默认上限为三。用户输入会重置预算。预算耗尽后，系统消息保持 deferred，直到下一次用户输入或下一次显式投递机会。

这用于限制自激链：完成通知唤醒 agent，agent 再启动工作，工作完成后再次唤醒。

### 系统消息

后台任务完成通知携带 job id、kind、状态和标签。模型使用 `job_output` 读取输出，并被要求不要轮询。

schedule 提醒使用固定的 `[SCHEDULE REMINDER]` 包装，并对 prompt 做 JSON 编码。prompt 被标记为不可信提醒内容。

### 递归计划保护

来源为 schedule 时，runner 在调用 `agent.loop` 前禁止 `cron_create`、`cron_update`、`cron_delete` 和 `cron_run_now`。计划任务可以运行，但不能创建更多计划。

### 取消与停机

取消会中止排队中与运行中的 turn，并继续传到 `agent.loop`。runner 状态只存在于进程内；queued、deferred 与 running turn 不会跨宿主停机保存。持久行为属于 schedule 定义和 session 文档。

-----

<a id="进一步探索"></a>
## 进一步探索

- [agent-core](../agent-core/README.zh.md)：runner 调用的低层循环能力。
- [jobs registry](../../jobs/jobs/README.zh.md)：后台任务状态、输出与完成事件。
- [schedule service](../../schedule/schedule/README.zh.md)：持久计划、模式与投递。
- [maota CLI](../../../apps/cli/README.zh.md)：面向用户的 jobs 与 cron 命令。