# 计划任务

[English](scheduled-tasks.md) | 中文

计划任务在稍后或重复运行。计划是持久定义。派发需要宿主正在运行，但定义与运行历史会跨重启保留。

## 目录

- [模式](#模式)
- [时间选择器](#时间选择器)
- [管理计划](#管理计划)
- [权限](#权限)
- [恢复](#恢复)
- [投递](#投递)
- [限制](#限制)
- [相关文档](#相关文档)

-----

<a id="模式"></a>
## 模式

| 模式 | 行为 |
|---|---|
| `remind` | 向原 session 发送提醒。上下文与权限策略留在该 session。 |
| `agent` | 在 fresh session 中运行自包含 prompt。prompt 不能依赖当前对话。 |
| `script` | 在 `$MAOTA_HOME/scripts` 下运行受控脚本，不调用模型，也不拼接 shell 字符串。 |

需要上下文时使用 `remind`。无人值守工作使用 `agent`。确定性的检查或命令足够时使用 `script`。

<a id="时间选择器"></a>
## 时间选择器

- `after_seconds`：一次性延迟。
- `at`：一次性 RFC3339 绝对时刻。
- `every_seconds`：固定间隔。
- `daily`：显式 IANA 时区中的本地时间。
- `weekly`：显式 IANA 时区中的本地时间与 ISO 星期集合。
- `cron`：显式 IANA 时区中的五字段 Vixie 表达式。

日历与 cron 计划必须提供 `timezone`。cron 方言拒绝秒字段、`L`、`W`、`#`，以及月份或星期名称。

<a id="管理计划"></a>
## 管理计划

模型工具为：

- `cron_create`
- `cron_list`
- `cron_update`
- `cron_delete`
- `cron_run_now`

CLI 使用 `maota cron list`、`add`、`update`、`remove`、`run`、`pause` 与 `resume`。两个入口都调用 `schedule` 能力，不直接写计划文件。

每条计划都需要 title。create 与 update 在保存前校验选择器、时区、模式、权限与脚本路径。

<a id="权限"></a>
## 权限

`remind` 继承来源 session 策略。`agent` 与 `script` 把 `ask`、`auto` 或 `full` 保存在任务上，缺省为 `ask`。无人值守的 `ask` 模式在无人应答时 fail closed。

只有在任务明确允许无人确认运行时，才使用 `auto` 或 `full`。

<a id="恢复"></a>
## 恢复

计划定义保存在 `$MAOTA_HOME/schedules.json`。运行记录保存在 `$MAOTA_HOME/schedule-runs`。

重启后，重复任务最多收到最近一次错过的 occurrence。错过的一次性任务也最多运行一次。不会批量补跑。

<a id="投递"></a>
## 投递

提醒或结果通过 `agent.runner` 进入 session，与后台任务完成通知使用同一路径。session 忙碌时消息等待当前 turn；session 空闲时 runner 在唤醒预算内启动 follow-up turn。

计划产生的模型 turn 不能创建或修改计划，这用于阻止递归调度。

<a id="限制"></a>
## 限制

- 宿主必须运行。
- 失败场景下投递是至少一次，不是 exactly once。
- 同一任务不会并发运行。
- 全局并发缺省为两次运行。
- 每个任务的运行历史最多保留 200 条与 30 天。
- 运行记录展示投递与状态，不证明模型完成了现实世界的工作。

<a id="相关文档"></a>
## 相关文档

- [schedule 包组](../../packages/schedule/README.zh.md)
- [tool-cron](../../packages/schedule/tool-cron/README.zh.md)
- [agent-runner](../../packages/agent/agent-runner/README.zh.md)