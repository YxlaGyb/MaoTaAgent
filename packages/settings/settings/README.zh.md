---
description: "Host 自有、带 revision 与原子 JSON 存储的语言和主题偏好。"
kind: "package-reference"
---

# settings

[English](README.md) | 中文

## 概述

`@maota/settings` 拥有 Web 界面要求 Host 记住的两项用户偏好：语言和主题。它提供 `settings.get` 与 `settings.update`，校验每一个接受的值，旧 revision 以 `-32060` 拒绝，并把接受的文档原子写入 `$MAOTA_HOME/settings.json`。修改成功后会发布 `settings.changed`，其他客户端无需轮询即可收敛。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

### 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `file` | string | `$MAOTA_HOME/settings.json` | 本插件读取和写入的偏好文档。 |

### 方法

| 方法 | 参数 | 返回 |
|---|---|---|
| `get` | 无 | `{ revision, locale, theme }`，当前用户偏好。文件不存在时读成 `{ revision: 0, locale: null, theme: null }`。 |
| `update` | `{ patch, expected_revision? }` | 合并后接受的视图。`patch` 接受 `locale` 与 `theme`；省略的字段保留已存值。旧 revision 返回 `-32060`，未知或畸形字段返回 `-32602`。把字段更新为已存值时不写盘、不发事件，直接返回当前视图。 |

### 值

| 值 | 可接受值 | 含义 |
|---|---|---|
| `locale` | `null`、`system`，或 `en`、`zh-CN` 这样的 BCP 47 风格 id | `null` 交给 i18n 的 profile 或系统语言；`system` 明确选择机器语言。 |
| `theme` | `null`、`system`、`dark` 或 `light` | `null` 交给 Web 默认值，也就是 `system`。 |
| `revision` | 非负整数 | `get` 返回的乐观并发令牌；调用方要防止旧写覆盖时必须回传。 |

### 事件

| 主题 | 载荷 |
|---|---|
| `settings.changed` | 完整的已接受视图 `{ revision, locale, theme }`。 |

事件是尽力送达。错过的客户端可以调用 `get` 并按 revision 比较。

### 存储文档

| 字段 | 含义 |
|---|---|
| `schema_version` | 本版本写出的每份文档都是 `1`。 |
| `revision` | 每次接受的修改都会加一。 |
| `locale` | 显式语言，或 `null`。 |
| `theme` | 显式主题，或 `null`。 |

### 声明

| 字段 | 值 |
|---|---|
| `provides` | `settings` |
| `injects` | 无 |
| `registrations` | 无 |
| `hostCalls` | 无 |
| `configKeys` | `file` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 能力本体：补丁校验、revision 检查、事件与 `selfCheck`。 |
| [`src/store.ts`](src/store.ts) | 文档模型：值读取、默认值、原子写入与 revision 比较。 |

### 带 revision 的写入

`update` 先读当前文档，再检查 `expected_revision`，合并接受的字段，只有发生变化时才写入下一个 revision。写入先落到同目录的临时文件，再改名就位并设为 `0600`，所以读者只会看到前一份或后一份文档，不会看到半份。`settings.changed` 只在改名完成后发布。

### 读取与失败

文档不存在时返回 revision 为零的空视图。不可读或畸形的文档以 `-32603` 拒绝，而不是用默认值覆盖。语言和主题都在持久化边界校验，畸形值无法进入 JSON 文档。

-----

<a id="further-exploration"></a>
## 进一步探索

- [i18n-native](../../../i18n/i18n-native/README.zh.md)：读取 `locale` 并跟随 `settings.changed` 的消费方。
- [web bridge](../../../apps/web/src/bridge.ts)：向浏览器暴露这些方法的 RPC 面。
- [base bundle](../../bundle/base/README.zh.md)：挂载这项能力的行清单。
