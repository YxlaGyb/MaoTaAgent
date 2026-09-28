---
description: "jobs 组：后台任务注册表、面向模型的工具，以及 producer 与 consumer 共用的生命周期。"
kind: "package-group"
---

# jobs

[English](README.md) | 中文

## 概述

jobs 组是后台工作接缝。producer 注册任务，追加输出与进度，并在资源停止后结算。owner 可以列出、读取、等待或终止任务。完成状态以事件发布。

任务只存在于当前宿主进程内，不跨停机保存。

## 目录

- [包](#包)
- [边界](#边界)
- [相关文档](#相关文档)

-----

<a id="包"></a>
## 包

| 包 | 职责 | 能力 |
|---|---|---|
| [`jobs`](jobs/README.zh.md) | 中心注册表、准入、owner 隔离、输出 ring、等待、kill 请求与 settle 事件。 | `jobs` |
| [`tool-jobs`](tool-jobs/README.zh.md) | 模型读取、列出和停止任务的工具。 | `tool.job_output`、`tool.job_list`、`tool.job_kill` |

<a id="边界"></a>
## 边界

- 注册表不启动工作，只保存身份、生命周期、访问、输出与完成状态。
- producer 拥有真实进程或任务，并且只在工作真正停止后结算。
- 任务只对所属 session 可见。
- 输出有上限，读取可能报告 lossy。
- `kill` 是请求，直到 producer 结算后任务才终止。
- 完成事件投递给 `agent.runner`，由 runner 决定是否唤醒 session。

<a id="相关文档"></a>
## 相关文档

- [后台任务用户指南](../../docs/user/background-tasks.zh.md)
- [agent-runner](../agent/agent-runner/README.zh.md)
- [pwsh-local](../shell/pwsh-local/README.zh.md)