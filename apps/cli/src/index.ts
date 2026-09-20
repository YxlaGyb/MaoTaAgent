#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { resolveConfigPath, resolveKernelBin } from "@maota/app-boot";
import { boot, type Chunk } from "@maota/host";

import { parseArgs } from "./args.ts";
import { restartOnSourceChange } from "./hmr.ts";

const VERSION =
  (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ??
  "0.0.0";

const USAGE = `maota: the MaoTa launcher

usage:
  maota               interactive: a prompt on a TTY, one turn per line otherwise
  maota <question>    ask once, print the final answer, exit
  maota serve         start the web plugin and stay resident (Ctrl-C to exit)
  maota check         check the config only, start nothing (the exit code comes from the kernel)
  maota --help        this text
  maota --version     print the version

options:
  --profile <name>  which profile to boot: serve picks the web profile, every other command
                    picks default. A profile is a directory under $MAOTA_HOME/profiles holding
                    the generated eggshell.toml and the eggshell.local.toml you edit beside it
  --config <path>   config file, overriding the profile (default: EGGSHELL_CONFIG)
  --kernel <bin>    kernel binary (default: EGGSHELL_BIN, then the installed eggshell-kernel,
                    then the neighbouring debug build)
  --session <id>    session id (default: cli)
  --json            check only: ask the kernel for a JSON report
  -h, --help        this text
  -v, --version     print the version

exit codes:
  0     clean exit
  1     runtime failure: the kernel did not boot, a stream reported an error, the kernel exited badly
  2     usage or config error: unknown option, missing option value, extra argument to serve/check, config file not found
  other whatever the kernel's shutdown returned, passed through
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

const profile = parsed.profile ?? (parsed.kind === "serve" ? "serve" : "default");
const config = await resolveConfigPath({ explicit: parsed.config, profile }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  return process.exit(2);
});
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

restartOnSourceChange(kernel);

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
