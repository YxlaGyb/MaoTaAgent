# `@virgena/maota`

[English](README.md) | 中文

`maota` 是 MaoTa 唯一的 Node 启动器：它定下这次运行读哪个配置文件、跑哪个内核二进制，把 eggshell 内核当子进程拉起来，并在内核的 stdio 协议上驱动它。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/main.ts`](src/main.ts) 负责入口模式与终端渲染。未知选项、选项缺值、`serve` 或 `check` 多带参数、配置文件不存在，都以非零码退出。

## 目录

- [入口模式](#entry-modes)
- [选项](#options)
- [退出码](#exit-codes)
- [配置解析](#configuration-resolution)
- [开发期热重载](#dev-hot-reload)
- [开发](#development)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="entry-modes"></a>
## 入口模式

| 命令 | 行为 |
|---|---|
| `maota` | 交互：TTY 下带 `> ` 提示符，否则逐行读 stdin。 |
| `maota <问句>` | 一次性：问一次，打印最终回答，退出。 |
| `maota serve` | 常驻：启动后报出 web 插件的 URL，一直待到 Ctrl-C。 |
| `maota check` | 只检查：跑内核自己的 `--check`，把它的退出码透传出去。 |
| `maota --help` | 打印用法并退出 0。 |
| `maota --version` | 打印 `maota <版本>` 并退出 0。 |

由第一个位置参数决定：`serve` 与 `check` 是子命令，后面不能再带参数；其它任何位置参数都算一次性问句，后面的参数用空格拼起来。

<a id="options"></a>
## 选项

| 选项 | 含义 |
|---|---|
| `--config <path>` | 要启动的配置文件。 |
| `--kernel <bin>` | 要拉起来的内核二进制。 |
| `--session <id>` | 会话 id，缺省 `cli`。 |
| `--json` | 只在 `check` 下有效：让内核输出 JSON 报告。 |
| `-h`, `--help` | 打印用法并退出 0。 |
| `-v`, `--version` | 打印版本并退出 0。 |

同一行里 `--help` 与 `--version` 压过其它一切。

<a id="exit-codes"></a>
## 退出码

| 码 | 含义 |
|---|---|
| 0 | 正常退出，包括内核 shutdown 返回 0 的情况。 |
| 1 | 运行期失败：内核没起来、流里报了错，或内核异常退出。 |
| 2 | 用法或配置错误：未知选项、选项缺值、`serve` 或 `check` 多带参数、配置文件不存在。 |
| 其它 | 内核 `shutdown` 返回什么就透传什么。 |

<a id="configuration-resolution"></a>
## 配置解析

两个输入都在重启任何东西之前由 [`@virgena/maota-boot-config`](../../packages/boot/config/README.zh.md) 定下：

- 配置文件：`--config`，其次 `EGGSHELL_CONFIG`，其次存在的 `$MAOTA_HOME/eggshell.local.toml`，最后 `$MAOTA_HOME/eggshell.toml`；`MAOTA_HOME` 缺省 `~/.maota`。首次运行会用包内的 `eggshell.default.toml` 生成后者，把仓库的绝对路径写进去，并往 stderr 打一行 `MaoTa: wrote <path>`。显式给的 `--config` 从不写入；文件不在，内核还没起来就以 2 退出。
- 内核二进制：`--kernel`，其次 `EGGSHELL_BIN`，其次安装好的 `eggshell-kernel` 二进制，最后隔壁 `eggshellmod` 的 debug 产物。

内核 stderr 上的日志行也走 stderr：`serve` 丢掉 `info` 行、留下的前缀是 `MaoTa`，其它模式前缀是 `[kernel]`。

<a id="dev-hot-reload"></a>
## 开发期热重载

生成的配置里那一行 `hmr` 插件是关着的。在机器层打开它，并把 `roots` 指向你在改的目录：

```toml
[plugins.hmr]
disabled = false
command = "node"
args = ["<repo>/packages/hmr/src/main.ts"]
[plugins.hmr.config]
roots = ["<repo>/apps", "<repo>/packages"]
```

那个插件监视 `roots`，把变动的路径以 `dev.source.changed` 发出去。CLI 对每条 `kernel.plugin.started` 事件读出该插件解析后的 `cwd` 与入口参数，走过这个入口的静态 import 图（[`src/graph.ts`](src/graph.ts)），记下哪个插件 import 了哪个文件。之后每条 `dev.source.changed` 路径都会解析到恰好 import 它的那些插件，这些插件以 `reason: "source"` 重启（[`src/hmr.ts`](src/hmr.ts)）。像 `packages/plugin-kit/src/index.ts` 这样的共享文件会重启每个 import 它的插件；没人 import 的路径什么也不重启。不写这一行就什么都不监视，所以生产运行里没有 watcher，CLI 自己也不额外监视。

<a id="development"></a>
## 开发

从源码直接跑；这个应用没有构建步骤：

| 命令 | 效果 |
|---|---|
| `pnpm boot` | 交互或一次性，看终端允许哪种。 |
| `pnpm boot "问句"` | 带问句的一次性。 |
| `pnpm web` | 等价于 `maota serve`。 |
| `pnpm check:config` | 等价于 `maota check`。 |
| `pnpm cli:smoke` | 语法与用法文本的冒烟测试，不需要内核。 |

`pnpm boot` 会把脚本名后面的内容原样转给 `maota`，所以 `pnpm boot serve`、`pnpm boot check --json`、`pnpm boot --session web "问句"` 也都能用。

`package.json` 里的 `bin.maota` 是为将来安装声明的；本仓库里没有任何东西把这个 bin 链进 `node_modules`，所以请用 `node` 直接跑这个文件，或走上面的 `pnpm` 脚本。

第一次 Ctrl-C 让内核以 `ui_quit` 停机，并以内核返回的码退出；停机在路上时后续的 Ctrl-C 不再重复。`check` 故意绕开 `boot()`，用内核自己的检查器并继承 stdio，因此诊断与退出码都属于内核。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制说明这个启动器在什么时候需要小心。它们是当前约束，不是任务积压。

- **选项从不透传给插件**：每个插件的设置都住在 `$MAOTA_HOME/eggshell.toml` 或它旁边的 `eggshell.local.toml`。
- **`serve` 没有自己的选项**：web 端口只能来自 `[plugins.web.config]`。
- **web 插件始终没监听的那次 `serve` 会一直等下去**：没有启动期限。
- **会话只能靠 `--session` 指认**：没有管理会话的子命令。
- **import 图是静态读出来的**：只经算出来的 specifier 或路径别名才能到达的模块不在图里，改它不重启任何东西。
- **热重载重启的是整个插件进程**：插件里的内存状态不会留下来。
- **这一切的前提是 `hmr` 那一行已经启用**：生成的那一行默认是关的。