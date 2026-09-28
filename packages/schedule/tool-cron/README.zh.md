---
description: "面向模型的 cron 工具：创建、列出、更新、删除和立即运行计划。"
kind: "package-reference"
---

# tool-cron

[English](README.md) | 中文

## 概述

提供 `cron_create`、`cron_list`、`cron_update`、`cron_delete` 与 `cron_run_now`，并把它们拆成独立工具，便于按动作控制 schema 与权限。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)

-----

<a id="使用本包"></a>
## 使用本包

### 工具

| 工具 | 用途 |
|---|---|
| `cron_create` | 创建 `remind`、`agent` 或 `script` 计划。 |
| `cron_list` | 列出计划、下一次 occurrence、运行次数与状态。 |
| `cron_update` | 修改选定字段，不替换整条计划。 |
| `cron_delete` | 按 id 删除一条计划。 |
| `cron_run_now` | 立即运行，不移动下一次 occurrence。 |

### 创建字段

- `title` 必填。
- `mode` 必填。
- `schedule_kind` 选择 `after`、`at`、`every`、`daily`、`weekly` 或 `cron`。
- `daily`、`weekly` 与 `cron` 必须提供 `timezone`。
- `remind` 使用宿主参数注入的来源 session 与 cwd。
- `agent` 需要自包含 prompt。
- `script` 需要 `$MAOTA_HOME/scripts` 下的相对路径。
- `permission` 在 agent 与 script 模式中缺省为 `ask`。
- `max_runs` 与 `not_after` 是可选上限。

### 结果

create 与 update 返回计划视图。list 返回活动与非活动计划。delete 返回 id 与删除标志。`run_now` 返回运行记录。

### 错误

非法选择器、时区、cron 语法、脚本路径或权限值会在保存前拒绝。未知 id 返回错误。计划产生的模型 turn 不能递归调用这些工具。

-----

<a id="理解实现"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具声明与 schedule 调用。 |
| [`src/render.ts`](src/render.ts) | 计划与运行记录渲染。 |

### 分离

工具插件只拥有校验与模型接口。持久化、时间、执行和历史属于 `schedule` 能力。

### 所有权

宿主参数注入来源 session 与 cwd。模型不能把其他 session 选为提醒目标。

-----

<a id="进一步探索"></a>
## 进一步探索

- [schedule service](../schedule/README.zh.md)
- [计划任务用户指南](../../../docs/user/scheduled-tasks.zh.md)
- [agent-runner](../../agent/agent-runner/README.zh.md)