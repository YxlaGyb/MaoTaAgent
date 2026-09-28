# 后台任务

[English](background-tasks.md) | 中文

后台任务在启动它的工具调用返回之后继续运行。它适合原本会阻塞当前 turn 的独立工作，例如构建、测试、安装、watcher 或长期服务。

## 目录

- [启动任务](#启动任务)
- [读取输出](#读取输出)
- [等待](#等待)
- [完成通知](#完成通知)
- [停止任务](#停止任务)
- [所有权与寿命](#所有权与寿命)
- [相关文档](#相关文档)

-----

<a id="启动任务"></a>
## 启动任务

当工作与下一步独立时，使用 `pwsh` 的 `run_in_background: true`。

工具先执行正常权限检查。命令允许启动后，它会立即返回 job id。模型必须保存这个 id。

不要因为完成通知尚未到达就重复启动同一份工作。

<a id="读取输出"></a>
## 读取输出

使用 `job_output` 读取输出：

- 不带 `wait` 时，只返回上次读取之后的新输出。
- `wait: true` 会等待结算或超时。缺省等待 30 秒，硬上限 10 分钟。
- 超时不会杀掉任务。
- 结算后的第一次读取还会返回一次性终态 result。

当不确定当前拥有哪些任务时，使用 `job_list`。

<a id="等待"></a>
## 等待

只有下一步确实被任务阻塞时才等待。否则继续独立工作，让完成通知自然到达。

等待会把结算标记为 `awaited`，runner 不会为同一个任务发送重复唤醒。

<a id="完成通知"></a>
## 完成通知

`agent.runner` 把完成通知投递给所属 session。忙碌 session 会在当前 turn 结束后收到 follow-up。空闲 session 会在唤醒预算内被唤醒。

通知包含 job id、kind、label 与状态，并提示模型用 `job_output` 读取输出。

<a id="停止任务"></a>
## 停止任务

使用 `job_kill`，传入 job id 和可选 reason。取消是请求。只有 producer 报告进程或任务停止后，job 才进入 `killed`。

也可以在 CLI 使用 `maota jobs kill <id>`。

<a id="所有权与寿命"></a>
## 所有权与寿命

任务属于启动它的 session。其他 session 不能读取或停止。

任务只存在于进程内。宿主必须保持运行。宿主停机会取消活动任务并移除记录。重启后不会恢复任务。

输出保留有上限。读取落在保留窗口之后时，会报告 lossy。

<a id="相关文档"></a>
## 相关文档

- [jobs 包组](../../packages/jobs/README.zh.md)
- [tool-pwsh](../../packages/shell/tool-pwsh/README.zh.md)
- [agent-runner](../../packages/agent/agent-runner/README.zh.md)