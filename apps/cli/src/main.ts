#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { resolveConfigPath, resolveKernelBin } from "../../../packages/boot/config/src/index.ts";
import { boot, type Chunk } from "../../../packages/boot/host/src/index.ts";

import { parseArgs } from "./args.ts";

const VERSION =
  (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ??
  "0.0.0";

const USAGE = `maota：MaoTa 的启动器

用法:
  maota               交互模式（TTY 下带提示符，否则逐行读 stdin）
  maota <问句>        问一次，打印最终回答后退出
  maota serve         启动 web 插件并常驻（Ctrl-C 退出）
  maota check         只检查配置，不启动（退出码来自内核）
  maota --help        这份用法
  maota --version     打印版本

选项:
  --config <path>   配置文件（缺省 EGGSHELL_CONFIG，其次 eggshell.local.toml，其次 eggshell.toml）
  --kernel <bin>    内核二进制（缺省 EGGSHELL_BIN，其次安装的 eggshell-kernel，其次隔壁仓库的 debug 产物）
  --session <id>    会话 id（缺省 cli）
  --json            只在 check 下有效：让内核输出 JSON 报告
  -h, --help        这份用法
  -v, --version     打印版本

退出码:
  0     正常退出
  1     运行期失败：内核起不来、流里报错、内核异常退出
  2     用法或配置错误：未知选项、选项缺值、serve/check 带参数、配置文件不存在
  其它  内核 shutdown 的返回码原样透传
`;

const parsed = parseArgs(process.argv.slice(2));
if (parsed.kind === "usage") {
  console.error(parsed.message);
  console.error("Run 'maota --help' for usage.");
  process.exit(2);
}
if (parsed.kind === "help") {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (parsed.kind === "version") {
  process.stdout.write(`maota ${VERSION}\n`);
  process.exit(0);
}

const config = resolveConfigPath({ explicit: parsed.config });
if (!existsSync(config)) {
  console.error(`config file not found: ${config}`);
  process.exit(2);
}
const bin = resolveKernelBin({ explicit: parsed.kernel });
const serve = parsed.kind === "serve";
const session = parsed.session;

if (parsed.kind === "check") {
  const status = spawnSync(bin, [config, "--check", ...(parsed.json ? ["--json"] : [])], { stdio: "inherit" });
  process.exit(status.status ?? 1);
}

const kernel = await boot(config, {
  bin,
  onLog: (line) => {
    const level = String(line.level ?? "info");
    if (level === "debug" || (serve && level === "info")) return;
    console.error(`${serve ? "MaoTa" : "[kernel]"}: ${line.message ?? JSON.stringify(line)}`);
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  return process.exit(1);
});

let closing = false;
process.on("SIGINT", () => {
  if (closing) return;
  closing = true;
  void kernel.shutdown("ui_quit").then((code) => process.exit(code));
});

function render(chunk: Chunk): void {
  const event = chunk.data as { type?: string; text?: string; tool?: string; args?: unknown; ok?: boolean; output?: unknown } | null;
  switch (event?.type) {
    case "text":
      process.stdout.write(String(event.text ?? ""));
      break;
    case "tool_call":
      console.error(`  -> ${event.tool} ${JSON.stringify(event.args)}`);
      break;
    case "tool_result":
      console.error(`  <- ${event.tool} ${event.ok ? "ok" : "failed"}: ${JSON.stringify(event.output ?? null).slice(0, 200)}`);
      break;
    case "done":
      if (typeof event.text === "string" && event.text !== "") process.stdout.write(`\n${event.text}`);
      process.stdout.write("\n");
      break;
  }
}

async function ask(input: string): Promise<void> {
  const stream = await kernel.invoke("agent.loop", "run", { session_id: session, input }, { stream: true });
  for await (const chunk of stream) {
    if (chunk.error) throw new Error(`kernel ended this stream: ${chunk.error.code} ${chunk.error.message}`);
    render(chunk);
  }
}

try {
  if (parsed.kind === "serve") {
    const info = (await kernel.invoke("web", "info").catch(() => null)) as
      | { url?: string; listening?: boolean }
      | null;
    console.log(
      info?.listening === true && info.url !== undefined
        ? `MaoTa web: ${info.url}`
        : "MaoTa web: the web plugin is not listening; see the line above",
    );
    await new Promise(() => undefined);
  } else if (parsed.kind === "once") {
    await ask(parsed.question);
  } else {
    const tty = process.stdin.isTTY === true;
    const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
    if (tty) lines.setPrompt("> ");
    for await (const line of lines) {
      if (line.trim() !== "") await ask(line.trim());
      if (tty) lines.prompt();
    }
    lines.close();
  }
  process.exit(await kernel.shutdown("ui_quit"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
