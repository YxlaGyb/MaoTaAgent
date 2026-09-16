#!/usr/bin/env node
// 宿主入口: 照配置起内核，把话交给 agent.loop，边来边打印。
//   node packages/boot/src/main.ts "帮我看看这个仓库"          # 一句话就退
//   node packages/boot/src/main.ts                            # 交互，同一个 session 连续问
//   echo "第一句`n第二句" | node packages/boot/src/main.ts
//   node packages/boot/src/main.ts --check                    # 只体检配置，不起对话
// 内核从哪来: $EGGSHELL_BIN > pnpm install 装进来的那份 > 旁边仓库的构建产物。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { kernel as installed } from "eggshell-kernel";
import { boot, type Chunk } from "../../../eggshell/eggshell.ts";

const root = join(import.meta.dirname, "..", "..", "..");

/** 剥掉 --flag value 这类选项，剩下的才是问题。 */
const argv = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i]?.startsWith("--")) continue;
  flags.set(argv[i]!.slice(2), argv[i + 1] ?? "true");
  i += 1;
}
const question = argv.filter((arg, index) => !arg.startsWith("--") && !argv[index - 1]?.startsWith("--")).join(" ");

// 配置入口: --config / $EGGSHELL_CONFIG 说了算；否则有 eggshell.local.toml（机器
// 本地层，不提交）就用它 —— 它 extends eggshell.toml，后写的键赢；都没有就用
// eggshell.toml 本身。内核只认路径，认它 extends 到哪几层是内核自己的事。
const explicit = flags.get("config") ?? process.env.EGGSHELL_CONFIG;
const local = join(root, "eggshell.local.toml");
const config = explicit ?? (existsSync(local) ? local : join(root, "eggshell.toml"));
if (!existsSync(config)) {
  console.error(`找不到配置文件 ${config}`);
  process.exit(2);
}
const bin =
  flags.get("kernel") ?? process.env.EGGSHELL_BIN ?? installed ?? join(root, "..", "eggshellmod", "target", "debug", "eggshell.exe");

// --check: 配置体检。内核 initialize 一遍所有插件、校验能力图和版本、算出启动
// 顺序，然后打印报告就退 —— 从不发 start、不碰 io，所以不联网也没副作用。
// 改完配置（哪一层都算）先跑这个（pnpm run check:config），别拿一次真对话试。
if (flags.has("check")) {
  const args = [config, "--check", ...(flags.has("json") ? ["--json"] : [])];
  process.exit(spawnSync(bin, args, { stdio: "inherit" }).status ?? 1);
}

// 内核和插件的日志走 stderr（一行一个 JSON），别混进回答里。
const kernel = await boot(config, {
  bin,
  onLog: (line) => {
    if (line.level === "error" || line.level === "warn") console.error(`[kernel] ${line.message ?? JSON.stringify(line)}`);
  },
});

// Ctrl+C: 让内核按协议停机，别留下孤儿插件进程。
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
      console.error(`  <- ${event.tool} ${event.ok ? "ok" : "失败"}: ${JSON.stringify(event.output ?? null).slice(0, 200)}`);
      break;
    case "done":
      if (typeof event.text === "string" && event.text !== "") process.stdout.write(`\n${event.text}`);
      process.stdout.write("\n");
      break;
  }
}

const session = flags.get("session") ?? "cli";

async function ask(input: string): Promise<void> {
  const stream = await kernel.invoke("agent.loop", "run", { session_id: session, input }, { stream: true });
  for await (const chunk of stream) {
    // 内核中途掐掉这条流时，错误在最后一块的 error 里 —— 不主动看就会"什么也没输出、退出码 0"。
    if (chunk.error) throw new Error(`内核终止了这条流: ${chunk.error.code} ${chunk.error.message}`);
    render(chunk);
  }
}

try {
  if (question !== "") {
    await ask(question);
  } else {
    // 交互/管道: 一行一句，共用同一个 session（历史在内核那侧的 agent 插件里）。
    const tty = process.stdin.isTTY === true;
    const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
    if (tty) lines.setPrompt("> ");
    for await (const line of lines) {
      if (line.trim() !== "") await ask(line.trim());
      if (tty) lines.prompt(); // 管道输入这时接口可能已经 close，prompt() 会抛
    }
    lines.close();
  }
  process.exit(await kernel.shutdown("ui_quit"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
