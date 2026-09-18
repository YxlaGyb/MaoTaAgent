---
description: "为一次 maota 启动定下读哪个配置文件、跑哪个内核二进制，优先级与 CLI 文档一致。"
kind: "package-reference"
---

# @virgena/maota-boot-config

[English](README.md) | 中文

## 摘要

定下每次启动都要的两个输入：要启动的配置文件、要拉起来的内核二进制。两个解析函数都是对 options 对象做纯路径运算，所以调用方可以注入临时仓库根或假环境，而不用碰真实环境。任何要拉起内核的 MaoTa 入口都可以用它；它从不读配置文件，因此也说不出挑中的那个文件是否有效。今天只有 CLI 在用。

## 目录

- [怎么用这个包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 怎么用这个包

两个函数，输入都走 options 对象：

```ts
import { resolveConfigPath, resolveKernelBin } from "../../boot/config/src/index.ts";

const config = resolveConfigPath({ explicit: flagValue }); // 传 undefined 就退回环境变量
const bin = resolveKernelBin({ explicit: flagValue });
```

### 优先级

| 输入 | 顺序，先命中者胜 |
|---|---|
| 配置文件 | `--config`、`EGGSHELL_CONFIG`、存在时的 `<repo>/eggshell.local.toml`、`<repo>/eggshell.toml` |
| 内核二进制 | `--kernel`、`EGGSHELL_BIN`、安装好的 `eggshell-kernel` 二进制、`<repo>/../eggshellmod/target/debug/eggshell.exe` |

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内幕：点击展开</summary>

这个模块从不读配置文件：分层（`extends`、后写的键赢、表逐键合并、数组整体替换）属于内核加载器。`repoRoot` 从 `src/` 上推四层，所以两个解析函数在哪儿被 import 都能算对。`resolveKernelBin` 从 `eggshell-kernel` 包拿安装后的二进制路径，并接受 `installed` 覆盖以便测试。

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `repoRoot`、`resolveConfigPath`、`resolveKernelBin` 与两个 options 类型 |

</details>

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 解析出路径不代表文件有效；唯一的校验是内核自己的 `--check`。
- 内核二进制的最后一个兜底写死了 Windows 的 `.exe` 后缀与 `debug` profile。
- 不做用户级配置或 `MAOTA_HOME` 的发现；会话根仍然归 session 插件。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>给维护者的上下文：点击展开</summary>

None.

</details>
