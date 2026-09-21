# 架构

[English](architecture.md) | 中文

MaoTa 是一个插件式 agent 框架：Rust 内核把每个插件当自己的子进程跑，在它们之间路由能力，对外只露一套 stdio 协议；Node 这一侧是拉起并驱动那个内核的前端。这一页是地图，不是契约；下面每个组件的细节都由它自己的 README 或源码文件负责。

## 组件

| 组件 | 它是什么 | 契约在哪 |
|---|---|---|
| `apps/cli` | `maota` 启动器：交互、一次性、`serve` 与 `check`。 | [README](../apps/cli/README.zh.md) |
| `apps/web` | web 插件：一个 HTTP 服务同时提供界面与宿主接口。只有 `serve` profile 会拉起它。 | `apps/web/src/index.ts` |
| `packages/boot/app-boot` | 为一次启动定下配置文件与内核二进制。 | [README](../packages/boot/app-boot/README.zh.md) |
| `packages/boot/host` | 拉起内核并在 stdio 上驱动它。 | [README](../packages/boot/host/README.zh.md) |
| `packages/boot/hmr` | 开发期监视插件：为它盯着的路径发布 `dev.source.changed`。 | `packages/boot/hmr/src/index.ts` |
| `packages/interaction/permission` | 审批闸门：会话跑在哪一档、还在等回答的问题，以及把每次提问和它的决定配成对的审计文件。 | [README](../packages/interaction/permission/README.zh.md) |
| `packages/*` | 内核插件：api、pwsh-local、permission、tool-pwsh、tool-fs、tool-fs-search、tools、skill、skill-filesystem、session 与 agent。 | `packages/<组>/<包>/src/index.ts`，例如 `packages/agent/agent-core/src/index.ts` |
| `packages/bundle/*` | 组合包：每个按包名列出某个 profile 挂载的插件行。 | [packages README](../packages/README.zh.md#bundles) |
| `eggshell` 二进制 | 内核本身以及它的 stdio 协议。 | `eggshellmod` 仓库 |

## 启动链路

1. `maota` 定下配置文件与内核二进制。
2. 它拉起内核，等内核答出能力表。
3. 内核把 `[plugins.<id>]` 每一项当自己的子进程起起来，按各插件的 `provides` 路由能力。
4. 前端 invoke 能力：CLI 驱动 `agent.loop`，web 应用通过自己的桥驱动 `session` 与 `agent.loop`。
5. 停机时内核收到 `ui_quit` 或 `kernel_exit`，停掉插件并以宿主报出的码退出。

开发运行还可能带上 `hmr` 插件（生成的那一行默认关着）：它把改动过的路径发布成 `dev.source.changed`。CLI 从每个 `kernel.plugin.started` 里读出解析后的入口，走一遍入口的静态 import 图，维护一份"文件 → 插件"索引；于是每条改动路径都精确落到 import 它的那几个插件上，再让内核以 `reason: "source"` 重启它们。

## 配置分层

- 仓库根什么都不放：启动器读 `$MAOTA_HOME`，缺省 `~/.maota`。每个 profile 自带一个 `node_modules`，里面为每一行放一条指向仓库内那个包的链接。
- 启动器一次只选一个 profile：serve 用 serve（base 加 web），其余命令用 default（只 base）。
- $MAOTA_HOME/profiles/<name>/eggshell.toml 由该 profile 列出的组合包生成。每一行只写包名，内核从该 profile 自己的 `node_modules` 里解析它，所以只有行变了才会重写这个文件。它是插件集：有哪些插件、怎么起；各插件的默认值由插件自己持有。
- `$MAOTA_HOME/profiles/<name>/eggshell.local.toml` 是机器自己的那层：网关、模型、钥匙。它 `extends` 生成的那份，并且赢过它。
- `disabled = true` 的行照样解析、照样参与合并，但内核从不拉起它，能力表里也没有它。后面的层写 `false` 就启用，内核的 reloader 自己会发现，不用重启。
- 后加载的层赢：表逐键合并，数组整体替换。
- 拼错的 config 键会被 `pnpm run check:config` 点名，只报不拦。

## 边界

- 插件之间从不直接调用；都走内核路由的能力。
- 审批闸门是插件，不是内核功能：内核像路由其它能力一样路由 `permission`，从不看命令。
- Node 宿主从不解释插件的配置值；它只挑路径、说协议。
- `apps/web` 和其它插件一样是插件；浏览器那一侧不持有任何内核特权。
- 内核从不监视源码；它只看自己的配置，并在宿主开口时重启被点名的那个插件。

## 相关文档

- [boot 包组](../packages/boot/README.zh.md)
- [fs 包组](../packages/fs/README.zh.md)
- [shell 包组](../packages/shell/README.zh.md)
- [interaction 包组](../packages/interaction/README.zh.md)
- [权限闸门](permission.zh.md)
- [bundle 包组](../packages/bundle/README.zh.md)
- [tools 分发器](../packages/agent/tools/README.zh.md)
- [maota CLI](../apps/cli/README.zh.md)
- [防御性模式](defensive-patterns.zh.md)
