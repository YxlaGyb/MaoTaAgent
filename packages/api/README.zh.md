---
description: "模型网关：面向要接一个后端、要在 OpenAI 与脚本后端之间选一个，或要查清一个 provider 收到过什么、一次失败的调用要付多大代价的维护者。"
kind: "package-reference"
---

# api

[English](README.md) | 中文

## 概述

`api` 是模型网关：agent loop 与 provider 之间唯一的那个插件，所以 loop 只管要一次 chat completion，从不需要知道是哪个后端答的。它提供一个 OpenAI 兼容的后端，以及一个给测试与演示用的脚本后端；它重试那些「有可能自己好」的失败，并把每一条要发出去的消息投影到一份很短的线格式白名单上，于是 harness 留给自己的字段不可能再从 provider 那边回来、像是模型写的一样。两个方法回答调用方：`chat` 与 `key`，而这是唯一持有凭据的插件。它不依赖任何其他能力。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

经 `api` 能力抵达它。

| 方法 | 参数 | 返回 |
|---|---|---|
| `chat` | `{ messages, tools?, model?, temperature? }` | 助手消息。调用方传了 `meta.stream` 时走流式，此时同一次调用在流上依次是 `delta`、`reasoning` 与收尾的 `message`。 |
| `key` | 无 | `{ has_key }`。 |
| `key_set` | `{ api_key }` | `{ has_key }`，前提是把密钥按 `0600` 权限写进 `$MAOTA_HOME/api_key`。空字符串就是忘掉它。 |

### 配置

| 键 | 缺省 | 含义 |
|---|---|---|
| `backend` | `openai` | `openai` 或 `scripted`。脚本后端从 `script` 取答案，从不打开 socket。 |
| `model` | `gpt-4o-mini` | 没有点名模型的请求会发往这个模型。 |
| `base_url` | `https://api.openai.com/v1` | OpenAI 兼容后端所在的地方。 |
| `api_key` | 无 | 密钥本身，写在配置里。只有它为空时才去读 `api_key_env`，再往后才读存下来的密钥文件。 |
| `api_key_env` | `OPENAI_API_KEY` | 读密钥用的环境变量。 |
| `retry_max` | `2` | 可重试的失败最多再试几次，于是一次调用最多发 `retry_max + 1` 次。 |
| `retry_backoff_ms` | `500` | 第一次重试前停多久。此后每次翻倍。 |
| `script` | `[]` | 脚本后端的步骤，按调用顺序：`{ text }` 是一次回答，`{ tool, args }` 是一次调用。越过末尾的步骤会用一句「脚本用完了」作答。 |

`readChat` 会拒绝消息不是非空数组、或其中某条没有 role 的请求，错误为 `-32602`。

### 错误码

| 码 | 含义 |
|---|---|
| `-32050` | 网关拒了凭据，或者根本没找到凭据。 |
| `-32051` | 网关正在限流。可重试。 |
| `-32052` | 网关或请求在上游失败了。可重试。 |
| `-32053` | 连接断了。可重试。 |
| `-32054` | 流里的某个分片不是 JSON。 |
| `-32055` | 流结束却没有任何内容。 |
| `-32013` | 调用方取消了。从不重试。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 能力本体：配置、凭据、三个方法、重试与 `selfCheck` |
| [`src/messages.ts`](src/messages.ts) | `readChat` 与线格式投影 |
| [`src/openai.ts`](src/openai.ts) | OpenAI 兼容后端：`chat`、`streamChat`、`asOpenAITools` 与错误映射 |
| [`src/scripted.ts`](src/scripted.ts) | 脚本后端，以及它读的那套步骤形状 |
| [`src/sse.ts`](src/sse.ts) | `SseParser`、`applyDelta`、`createAccumulator` 与 `messageFromAccumulator` |

### 只有一部分失败会被重试

一个失败只有「有可能自己好」时才重试：网关正忙、坏了或够不着，也就是 `429`、`5xx` 或连接断掉。被拒的凭据、形状不对的请求、不是 JSON 的分片，以及被取消的一轮，都是回答而不是意外，所以立刻原样回来。每次重试前的停顿翻倍，调用方一取消，abort 信号就结束等待。

一条流只在什么都没推出去过的时候才重试：调用方已经读到的文本收不回来，所以第一个 delta 之后才断掉的流按它发生的样子上报，而不是从头再来。

### 线格式投影

`readChat` 从白名单 `role`、`content`、`tool_calls`、`tool_call_id` 与 `name` 重建每一条消息。harness 留下的比这更多：一条目录注记带着它的 `source`，一条消息还可能点名它来自哪个能力。那些都是本地的记账，万一漏给 provider，下一轮就会像是模型自己写的一样回来。

### 流式

流是一串帧，而一帧可能被网络切成两半：`SseParser` 把没读完的那一行留到剩下的部分抵达，把同一帧里的 `data:` 行用换行接起来，并把 `[DONE]` 当成单独的一帧。`applyDelta` 把每一帧的 delta 折进一个累加器，正是它把 provider 分片吐出的工具调用碎片拼成 loop 期待的那一条消息。

### 配置自检

`selfCheck` 覆盖那些不需要网络的部分：脚本后端的文本步骤与工具步骤、线格式投影、SSE 解析器的半行与多行帧、累加器把工具参数粘起来的行为、包括 abort 在内的错误映射，以及重试规则——重试用一个固定失败几次的后端脚本来验。`--check` 跑出来一旦有任何一处漂移就失败，所以 `pnpm check:plugins` 不需要内核、也不需要模型就能把它抓住。

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-core](../agent/agent-core/README.zh.md)：经这个插件把一轮跑成流式的调用方。
- [plugin-kit](../plugin-kit/README.zh.md)：`runPlugin`、`CallError`，以及流抵达的那个 channel。
- [架构](../../docs/architecture.zh.md)：网关在启动链路里的位置。