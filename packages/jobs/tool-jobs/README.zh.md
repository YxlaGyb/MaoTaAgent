---
description: "面向模型的后台任务工具：job_output、job_list 与 job_kill。"
kind: "package-reference"
---

# tool-jobs

[English](README.md) | 中文

## 概述

提供 `job_output`、`job_list` 与 `job_kill`。这些工具从不启动工作。`tool-pwsh` 等 producer 注册后台任务并返回 id，模型稍后读取或停止任务。完成通知负责提示模型何时行动。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)

-----

<a id="使用本包"></a>
## 使用本包

### 工具

| 工具 | 参数 | 结果 |
|---|---|---|
| `job_output` | `job_id`、`wait?`、`timeout_ms?` | 新输出、lossy 标记、状态，以及一次性终态 result。 |
| `job_list` | 无 | 当前 owner 的任务 id、kind、状态和标签。 |
| `job_kill` | `job_id`、`reason?` | 取消请求或已经结束的结果。 |

`job_output` 缺省非阻塞。`wait: true` 缺省等待 30 秒，硬上限 10 分钟。超时不会杀死任务。

`job_kill` 要求 producer 停止。只有 producer 报告资源已经停止后，任务才以 `killed` 结算。

### 模型指引

插件注册一段 system prompt，要求模型：

- 保存每个 job id。
- 继续独立工作，不轮询。
- 最终回答前用 `job_output` 收集仍然相关的结果。
- 终止不再需要的任务。

### 依赖

需要 `jobs`。存在 `system-prompt` 时注册指引段落。

-----

<a id="理解实现"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具声明、jobs 调用、prompt 注册和自检。 |
| [`src/render.ts`](src/render.ts) | 任务列表与输出渲染。 |

### 所有权

每次工具调用都注入 `session_id`。注册表确认任务属于该 session。模型不能读取或终止其他 session 的任务。

### 终态结果

producer 的 `result` 在结算后只返回一次。显式等待过任务的模型已经收到结算，注册表会把它标记为 `awaited`，runner 不再发送重复唤醒。

### 限制

工具面没有 job-start 方法。启动工作属于拥有 producer 的工具，例如使用 `run_in_background: true` 的 `pwsh`。

-----

<a id="进一步探索"></a>
## 进一步探索

- [jobs registry](../jobs/README.zh.md)
- [agent-runner](../../agent/agent-runner/README.zh.md)
- [tool-pwsh](../../shell/tool-pwsh/README.zh.md)