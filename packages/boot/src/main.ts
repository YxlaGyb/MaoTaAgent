import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { kernel as installed } from "eggshell-kernel";
import { boot, type Chunk } from "../../../eggshell/eggshell.ts";

const root = join(import.meta.dirname, "..", "..", "..");

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i]?.startsWith("--")) continue;
  flags.set(argv[i]!.slice(2), argv[i + 1] ?? "true");
  i += 1;
}
const question = argv.filter((arg, index) => !arg.startsWith("--") && !argv[index - 1]?.startsWith("--")).join(" ");

const serve = flags.has("serve");
const explicit = flags.get("config") ?? process.env.EGGSHELL_CONFIG;
const local = join(root, "eggshell.local.toml");
const config = explicit ?? (existsSync(local) ? local : join(root, "eggshell.toml"));
if (!existsSync(config)) {
  console.error(`config file not found: ${config}`);
  process.exit(2);
}
const bin =
  flags.get("kernel") ?? process.env.EGGSHELL_BIN ?? installed ?? join(root, "..", "eggshellmod", "target", "debug", "eggshell.exe");

if (flags.has("check")) {
  const args = [config, "--check", ...(flags.has("json") ? ["--json"] : [])];
  process.exit(spawnSync(bin, args, { stdio: "inherit" }).status ?? 1);
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

const session = flags.get("session") ?? "cli";

async function ask(input: string): Promise<void> {
  const stream = await kernel.invoke("agent.loop", "run", { session_id: session, input }, { stream: true });
  for await (const chunk of stream) {
    if (chunk.error) throw new Error(`kernel ended this stream: ${chunk.error.code} ${chunk.error.message}`);
    render(chunk);
  }
}

try {
  if (serve) {
    const info = (await kernel.invoke("web", "info").catch(() => null)) as
      | { url?: string; listening?: boolean }
      | null;
    console.log(
      info?.listening === true && info.url !== undefined
        ? `MaoTa web: ${info.url}`
        : "MaoTa web: the web plugin is not listening; see the line above",
    );
    await new Promise(() => undefined);
  } else if (question !== "") {
    await ask(question);
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
