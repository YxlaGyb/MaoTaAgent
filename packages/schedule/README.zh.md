---
description: "schedule 组：持久提醒与自动化，以及面向模型的 cron 工具。"
kind: "package-group"
---

# schedule

[English](README.md) | 中文

## 概述

schedule 组是持久自动化接缝。它保存计划、计算下一次发生时间、派发工作、记录历史，并暴露独立的模型管理工具。它不依赖进程内的 jobs 注册表。

## 目录

- [包](#包)
- [边界](#边界)
- [相关文档](#相关文档)

-----

<a id="包"></a>
## 包

| 包 | 职责 | 能力 |
|---|---|---|
| [`schedule`](schedule/README.zh.md) | 持久存储、时钟、执行模式、权限、并发、历史和调度循环。 | `schedule` |
| [`tool-cron`](tool-cron/README.zh.md) | 五个计划管理模型工具。 | `tool.cron_create`、`tool.cron_list`、`tool.cron_update`、`tool.cron_delete`、`tool.cron_run_now` |

<a id="边界"></a>
## 边界

- 计划是持久定义，不是运行中的进程。
- `remind` 向原 session 发送系统消息。
- `agent` 在 fresh session 中运行自包含 prompt。
- `script` 不调用模型，只运行受控脚本。
- 调度器只在宿主运行期间工作。
- 重复任务不会批量补跑。重启后每个任务最多补发最近一次错过的 occurrence。
- 计划产生的模型 turn 不能创建或修改计划。

<a id="相关文档"></a>
## 相关文档

- [计划任务用户指南](../../docs/user/scheduled-tasks.zh.md)
- [agent-runner](../agent/agent-runner/README.zh.md)
- [jobs registry](../jobs/jobs/README.zh.md)