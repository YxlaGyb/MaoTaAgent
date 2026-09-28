---
description: "jobs registry：job 身份、owner 隔离、准入、生命周期、有界输出、等待、取消和完成事件。"
kind: "package-reference"
---

# jobs registry

[English](README.md) | 中文

## 概述

注册表持有 job id、owner 访问、准入上限、生命周期、输出 ring、等待与 settle 事件。producer 先注册再启动工作，运行期间追加输出与进度，并只在资源停止后结算。记录只存在于进程内。

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
| `register` | `{ kind, label, owner?, cwd?, producer, producer_job_id }` | `{ id }`。 |
| `append` | `{ id, text, channel?, gap_before? }` | `{}`。 |
| `progress` | `{ id, line }` | `{}`。 |
| `settle` | `{ id, status, detail?, result? }` | 最终 job 视图。 |
| `list` | `{ owner? }` | `{ jobs }`。 |
| `get` | `{ id, owner? }` | job 视图。 |
| `read` | `{ id, owner? }` | 从模型游标开始的输出、一次性的 result 与状态。 |
| `wait` | `{ id, owner?, timeout_ms? }` | 结算或超时时的 job 视图。 |
| `kill` | `{ id, owner?, reason? }` | `{ outcome: "requested" 或 "already-finished" }`。 |

### 状态

`running`、`stopping`、`completed`、`failed`、`killed`。

### 事件

注册表发布 `jobs.registered`、`jobs.progress`、`jobs.settled` 与 `jobs.removed`。settle 事件带 `awaited`，已经消费结果的调用方不会再次唤醒 session。

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `max_jobs_per_owner` | `10` | 每个 owner 的运行或停止中任务上限。 |
| `max_jobs_total` | `32` | 进程内运行或停止中任务上限。 |
| `running_output_bytes` | `262144` | 运行期保留的输出字节。 |
| `settled_output_bytes` | `16384` | 结算后保留的输出字节。 |

-----

<a id="理解实现"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | capability 定义、配置、方法与停机。 |
| [`src/registry.ts`](src/registry.ts) | 记录、生命周期、等待方、取消与事件发布。 |
| [`src/admission.ts`](src/admission.ts) | owner 与全局准入上限。 |
| [`src/ring.ts`](src/ring.ts) | 有界输出存储与游标读取。 |
| [`src/events.ts`](src/events.ts) | 事件主题名。 |

### 生命周期

producer 启动工作前先完成准入。准入失败时不会创建进程或 job id。

取消会把运行中任务转到 `stopping`，并调用 producer 的 `job_cancel`。只有 producer 结算后，任务才进入 `killed`。

producer 消失后任务是 unavailable。记录仍可查看和读取，但不能被复活。

### 输出

运行 ring 保留最新字节。读取游标早于保留窗口时返回 lossy。终态 result 只由 `read` 返回一次，显式 wait 会把结算标记为 `awaited`。

### 限制

任务只存在于进程内。宿主停机即结束记录。该包没有持久重试队列，也没有跨进程 backend。

-----

<a id="进一步探索"></a>
## 进一步探索

- [tool-jobs](../tool-jobs/README.zh.md)：面向模型的控制工具。
- [agent-runner](../../agent/agent-runner/README.zh.md)：完成通知投递。
- [shell/pwsh-local](../../shell/pwsh-local/README.zh.md)：第一个 producer。