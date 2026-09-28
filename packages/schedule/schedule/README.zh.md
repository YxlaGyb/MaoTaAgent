---
description: "schedule service：持久定义、时间选择器、执行模式、权限、恢复和有界历史。"
kind: "package-reference"
---

# schedule service

[English](README.md) | 中文

## 概述

服务把计划保存在 `$MAOTA_HOME/schedules.json`。它支持 `remind`、fresh-session `agent` 与无 LLM 的 `script` 三种运行方式，宿主重启后每个任务最多补发一次最近错过的 occurrence，并写入有界运行历史。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)

-----

<a id="使用本包"></a>
## 使用本包

### 方法

| 方法 | 参数 | 回答 |
|---|---|---|
| `create` | 计划字段 | 已保存记录。 |
| `list` | 无 | `{ schedules }`。 |
| `update` | id 与变更字段 | 更新后的记录。 |
| `delete` | `{ id }` | `{ id, deleted }`。 |
| `run_now` | `{ id }` | 运行记录。 |
| `history` | `{ id, limit? }` | 最新运行记录。 |

### 时间选择器

| 选择器 | 含义 |
|---|---|
| `after_seconds` | 从创建或最近一次时间更新开始的一次性延迟。 |
| `at` | 一次性 RFC3339 绝对时刻。 |
| `every_seconds` | 以创建或最近一次时间更新为锚点的固定间隔。 |
| `daily` | 显式 IANA 时区中的本地钟表时间。 |
| `weekly` | 显式 IANA 时区中的本地时间与 ISO 星期集合。 |
| `cron` | 在显式 IANA 时区中求值的五字段 Vixie 表达式。 |

cron 方言支持 `*`、单值、范围、步长和逗号列表。拒绝秒字段、`L`、`W`、`#`，以及月份或星期名称。

### 模式

| 模式 | 行为 |
|---|---|
| `remind` | 向来源 session 投递提醒，权限策略继承该 session。 |
| `agent` | 在 fresh session 中运行自包含 prompt，使用任务保存的权限策略。 |
| `script` | 运行 `$MAOTA_HOME/scripts` 下的文件，参数以数组传递，不经过 shell 拼接。 |

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_parallel_runs` | `2` | 同时运行的计划任务上限。 |

运行历史每个任务最多保留 200 条记录和 30 天文件。

-----

<a id="理解实现"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务定义、调度循环、持久化和方法。 |
| [`src/clock.ts`](src/clock.ts) | 选择器校验与下一次 occurrence 计算。 |
| [`src/execution.ts`](src/execution.ts) | remind、agent 与 script 执行。 |
| [`src/store.ts`](src/store.ts) | 原子 schedules 文件。 |
| [`src/history.ts`](src/history.ts) | 有界运行记录。 |
| [`src/security.ts`](src/security.ts) | prompt 校验与拦截模式。 |

### 派发

调度器每秒检查一次。派发前保存 `pending_at`，所以接受后崩溃仍能重试同一 occurrence。执行结束后清除 pending，并计算下一目标。

同一任务不会并发运行。全局执行上限是 `max_parallel_runs`。

### 恢复

schedules 文件持久化。启动时，错过的重复任务只投递最近一次 occurrence。错过的一次性任务也最多投递一次。未来 occurrence 正常继续。

### 权限

`remind` 继承来源 session 策略。`agent` 与 `script` 使用任务保存的 `ask`、`auto` 或 `full` 策略。无人值守的 `ask` 模式在无人应答时 fail closed。

### 限制

宿主必须运行。没有独立 daemon，没有跨 host 选主，也不保证 exactly-once。投递历史记录尝试，不证明模型完成了请求。

-----

<a id="进一步探索"></a>
## 进一步探索

- [tool-cron](../tool-cron/README.zh.md)
- [agent-runner](../../agent/agent-runner/README.zh.md)
- [background jobs](../../jobs/jobs/README.zh.md)