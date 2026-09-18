---
description: "为一次 maota 启动定下读哪个配置文件、跑哪个内核二进制，并在首次运行时生成用户级配置。"
kind: "package-reference"
---

# @virgena/maota-boot-config

[English](README.md) | 中文

## 概述

定下每次启动都要的两个输入：要启动的配置文件、要拉起来的内核二进制。配置住在 `MAOTA_HOME`（缺省 `~/.maota`）；首次运行会把包内默认写过去，同级目录里若有 `eggshell.local.toml` 就压过那份生成物。两个解析函数都是对 options 对象做纯路径运算，所以调用方可以注入临时 home 或假环境，而不用碰真实环境。任何要拉起内核的 MaoTa 入口都可以用它；它从不读配置文件，因此也说不出挑中的那个文件是否有效。今天只有 CLI 在用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

凡是需要决定读哪个配置文件、跑哪个内核二进制的入口，都先解析一次，再把两条路径交给宿主。这些函数都不读配置文件，所以解析出路径不代表那个文件有效。

### 解析两个输入

```ts
import { resolveConfigPath, resolveKernelBin, maotaHome } from "../../boot/config/src/index.ts";

const home = maotaHome();
const config = resolveConfigPath({ explicit: flagValue });
const bin = resolveKernelBin({ explicit: flagValue });
```

### 优先级

| 输入 | 顺序，先命中者胜 |
|---|---|
| 配置文件 | `--config`、`EGGSHELL_CONFIG`、存在时的 `<home>/eggshell.local.toml`、`<home>/eggshell.toml`（缺失时用包内默认生成） |
| Home | `MAOTA_HOME`，再退到 `~/.maota` |
| 内核二进制 | `--kernel`、`EGGSHELL_BIN`、安装好的 `eggshell-kernel` 二进制、`<repo>/../eggshellmod/target/debug/eggshell.exe` |

显式给了 `--config`，或注入了 `root`，都不会写盘：这两种情况下文件缺失就是缺失。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本节说明这两个解析函数内部怎么工作；它们接受哪些输入见 [使用本包](#use-this-package)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `repoRoot`、`maotaHome`、`writeDefaultConfig`、`resolveConfigPath`、`resolveKernelBin` 与 options 类型 |
| [`eggshell.default.toml`](eggshell.default.toml) | 全新 home 起步时的插件集：`{{repo}}` 占位，hmr 行默认关闭 |

### 首次运行时的生成

这个模块从不读配置文件：分层（`extends`、后写的键赢、表逐键合并、数组整体替换）属于内核加载器。`writeDefaultConfig` 把 `eggshell.default.toml` 抄一份，把每个 `{{repo}}` 换成仓库绝对路径，所以文件被搬到别处入口也还有效；它往 stderr 写一行 `MaoTa: wrote <path>`，且绝不覆盖已存在的文件。`repoRoot` 从 `src/` 上推四层，所以两个解析函数在哪儿被 import 都能算对。`resolveKernelBin` 从 `eggshell-kernel` 包拿安装后的二进制路径，并接受 `installed` 覆盖以便测试。

-----

<a id="further-exploration"></a>
## 进一步探索

- [boot 包组](../README.zh.md)：这两个解析函数所属的启动粘合层。
- [maota CLI](../../../apps/cli/README.zh.md)：唯一的调用方，以及喂给两个解析函数的 flag。
- [架构](../../../docs/architecture.zh.md#configuration-layering)：生成物与机器层如何叠起来。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制说明这个包在什么时候需要小心。它们是当前约束，不是任务积压。

- **解析不等于校验**：只有内核自己的 `--check` 能说一份配置有效。
- **最后一个内核兜底是 Windows 形状**：写死了 `.exe` 后缀与 `debug` profile。
- **生成的配置在生成那一刻就冻住了**：包内默认更新不会改动已存在的 `<home>/eggshell.toml`。
- **还没有 settings 与凭据层**：会话根仍然归 session 插件。
