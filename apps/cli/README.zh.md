# @virgena/maota

[English](README.md) | 中文

`maota` 是 MaoTa 唯一的 Node 启动器：它决定这次读哪个配置文件、跑哪个内核二进制，把 eggshell 内核当子进程拉起来，再按内核的 stdio 协议驱动它。[`src/args.ts`](src/args.ts) 管命令行语法，[`src/main.ts`](src/main.ts) 管入口模式和终端渲染。未知选项、选项缺值、给 `serve` 或 `check` 塞多余参数、配置文件不存在，都以非零码退出。

## 目录

- [入口模式](#entry-modes)
- [选项](#options)
- [退出码](#exit-codes)
- [配置解析](#configuration-resolution)
- [开发](#development)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="entry-modes"></a>
## 入口模式

| 命令 | 行为 |
|---|---|
| `maota` | 交互：TTY 下给 `> ` 提示符，否则逐行读一轮。 |
| `maota <问句>` | 一次性：问一轮，打印最终回答后退出。 |
| `maota serve` | 常驻：启动后报出 web 插件的地址，按 Ctrl-C 退出。 |
| `maota check` | 只检查：跑内核自己的 `--check`，把它退出码透传出来。 |
| `maota --help` | 打印用法后退出 0。 |
| `maota --version` | 打印 `maota <版本>` 后退出 0。 |

由第一个位置参数决定：`serve` 和 `check` 是子命令，不接受更多参数；其它位置参数开启一次提问，其后的参数按空格拼在一起。

<a id="options"></a>
## 选项

| 选项 | 含义 |
|---|---|
| `--config <path>` | 要启动的配置文件。 |
| `--kernel <bin>` | 要拉起来的内核二进制。 |
| `--session <id>` | 会话 id，缺省 `cli`。 |
| `--json` | 只在 `check` 下有效：让内核输出 JSON 报告。 |
| `-h`, `--help` | 打印用法后退出 0。 |
| `-v`, `--version` | 打印版本后退出 0。 |

同一行里 `--help` 与 `--version` 优先于其它所有内容。

<a id="exit-codes"></a>
## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 正常退出，包括内核 shutdown 返回 0 的情况。 |
| 1 | 运行期失败：内核起不来、某条流报错、内核异常退出。 |
| 2 | 用法或配置错误：未知选项、选项缺值、给 `serve` 或 `check` 塞多余参数、配置文件不存在。 |
| 其它 | 内核 `shutdown` 返回什么就透传什么。 |

<a id="configuration-resolution"></a>
## 配置解析

两个输入在任何东西被拉起来之前由 [`@virgena/maota-boot-config`](../../packages/boot/config/README.zh.md) 挑好：

- 配置文件：`--config`，其次 `EGGSHELL_CONFIG`，其次存在的 `eggshell.local.toml`，最后 `eggshell.toml`。文件不在，内核还没起来就以 2 退出。
- 内核二进制：`--kernel`，其次 `EGGSHELL_BIN`，其次安装好的 `eggshell-kernel` 二进制，最后隔壁 `eggshellmod` 的 debug 产物。

内核 stderr 上的日志行走 stderr：`serve` 丢掉 `info` 行、留下的一行以 `MaoTa` 开头，其它模式以 `[kernel]` 开头。

<a id="development"></a>
## 开发

直接从源码跑，这个 app 没有构建步骤：

| 命令 | 效果 |
|---|---|
| `pnpm boot` | 终端允许什么就是什么：交互或一次性。 |
| `pnpm boot "问句"` | 带问句的一次性提问。 |
| `pnpm web` | 等价于 `maota serve`。 |
| `pnpm check:config` | 等价于 `maota check`。 |
| `pnpm cli:smoke` | 语法与用法文本的冒烟测试，不需要内核。 |

`pnpm boot` 会把脚本名后面的内容原样转给 `maota`，所以 `pnpm boot serve`、`pnpm boot check --json`、`pnpm boot --session web "问句"` 也都能用。

`package.json` 里的 `bin.maota` 是为将来安装声明的；本仓库里没有任何东西把这个 bin 链进 `node_modules`，所以请用 `node` 直接跑这个文件，或走上面的 `pnpm` 脚本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 选项从不透传给插件；每个插件的设置都住在 `eggshell.toml` 或 `eggshell.local.toml`。
- `serve` 没有自己的选项，web 端口只能来自 `[plugins.web.config]`。
- web 插件始终没监听的那次 `serve` 会一直等下去，不会退出。
- 没有会话管理子命令；会话只能靠 `--session` 指认。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>给维护者的上下文：点击展开</summary>

第一次 Ctrl-C 让内核以 `ui_quit` 停机，并以内核返回的码退出；停机在路上时后续的 Ctrl-C 不再重复。`check` 故意绕开 `boot()`，用内核自己的检查器并继承 stdio，因此诊断与退出码都属于内核。

</details>
