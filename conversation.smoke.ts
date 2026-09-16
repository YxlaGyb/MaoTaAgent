// 整条链路跑一遍: 真内核 + 六个真插件 + 一个假模型（api 的 scripted 后端，不碰网络）。
//
// 先在 eggshellmod 里构建内核:
//   cargo build -p eggshell-kernel --features fixture,host
// 再跑:
//   pnpm run conversation            # 用 pnpm install 装好的内核
//   node conversation.smoke.ts [eggshell.exe]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { kernel as installedKernel } from "eggshell-kernel";

import { boot, type Chunk } from "./eggshell/eggshell.ts";

const root = import.meta.dirname;
const kernelBin =
  process.argv[2] ??
  process.env.EGGSHELL_BIN ??
  installedKernel ??
  join(root, "..", "eggshellmod", "target", "debug", "eggshell.exe");

function plugin(id: string, name: string): string[] {
  return [
    `[plugins.${id}]`,
    `command = '${process.execPath}'`,
    `args = ['${join(root, "packages", name, "src", "main.ts")}']`,
    "",
  ];
}

const dir = mkdtempSync(join(tmpdir(), "maota-conversation-"));
mkdirSync(join(dir, "skills", "hello"), { recursive: true });
writeFileSync(
  join(dir, "skills", "hello", "SKILL.md"),
  "---\nname: hello\ndescription: greet the user\n---\n\nSay hello politely.\n",
);

writeFileSync(
  join(dir, "eggshell.toml"),
  [
    ...plugin("api", "api"),
    ...plugin("shell", "shell"),
    ...plugin("tools", "tools"),
    ...plugin("skill-filesystem", "skill-filesystem"),
    ...plugin("skill", "skill"),
    ...plugin("agent", "agent"),
    "",
  ].join("\n"),
);
const config = join(dir, "eggshell.local.toml");
writeFileSync(
  config,
  [
    'extends = ["eggshell.toml"]',
    "",
    "[plugins.api.config]",
    'backend = "scripted"',
    'model = "smoke"',
    "script = [",
    '  { tool = "shell", args = { command = "echo hi" } },',
    '  { tool = "skill", args = { name = "hello" } },',
    '  { text = "all done" },',
    '  { text = "second turn" },',
    "]",
    "",
    "[plugins.skill-filesystem.config]",
    `dirs = ['${join(dir, "skills").replace(/\\/g, "/")}']`,
    "",
  ].join("\n"),
);

const logs: string[] = [];
const kernel = await boot(config, {
  bin: kernelBin,
  onLog: (line) => logs.push(String(line.message ?? JSON.stringify(line))),
});

async function turn(params: Record<string, unknown>): Promise<any[]> {
  const chunks: Chunk[] = [];
  const stream = await kernel.invoke("agent.loop", "run", params, { stream: true });
  for await (const chunk of stream) chunks.push(chunk);
  return chunks.map((chunk) => chunk.data).filter((data) => data !== null) as any[];
}

function show(label: string, events: any[]): void {
  for (const event of events) {
    const detail =
      event.type === "tool_call"
        ? JSON.stringify(event.args)
        : event.type === "tool_result"
          ? (event.ok ? "" : "FAILED ") + JSON.stringify(event.output).slice(0, 160)
          : event.type === "text" || event.type === "done"
            ? JSON.stringify(event.text)
            : "";
    console.log(`  ${label} ${event.type.padEnd(11)} ${detail}`);
  }
}

const table = await kernel.capabilities();
for (const [capability, route] of Object.entries(table)) console.log(`  ${capability} = ${route.plugin} (${route.version})`);
assert.equal(table["agent.loop"]?.plugin, "agent");
assert.equal(table["tool.shell"]?.plugin, "shell");

const tools = (await kernel.invoke("tools", "list", {})) as { tools: Array<{ name: string }> };
assert.deepEqual(
  tools.tools.map((tool) => tool.name),
  ["shell"],
);
const skills = (await kernel.invoke("skill", "list", {})) as { skills: Array<{ name: string }> };
assert.deepEqual(
  skills.skills.map((skill) => skill.name),
  ["hello"],
);
const ran = (await kernel.invoke("tool.shell", "run", { command: "echo hi" })) as { exit_code: number; stdout: string };
assert.equal(ran.exit_code, 0);
assert.ok(ran.stdout.includes("hi"), `shell printed ${JSON.stringify(ran.stdout)}`);

console.log("\nturn 1 (say hi)");
const first = await turn({ session_id: "smoke", input: "say hi" });
show("1", first);
assert.ok(first.some((event) => event.type === "step"), "loop should emit step events");
const shelled = first.find((event) => event.type === "tool_result" && event.tool === "shell");
assert.equal(shelled?.ok, true);
assert.ok(String(shelled?.output?.result?.stdout).includes("hi"), `shell result: ${JSON.stringify(shelled?.output)}`);
const read = first.find((event) => event.type === "tool_result" && event.tool === "skill");
assert.ok(String(read?.output?.content).includes("Say hello"), `skill result: ${JSON.stringify(read?.output)}`);
const done = first.at(-1);
assert.equal(done?.type, "done");
assert.equal(done?.text, "all done");
assert.equal(done?.steps, 3);

console.log("\nturn 2 (again)");
const second = await turn({ session_id: "smoke", input: "again" });
show("2", second);
assert.equal(second.at(-1)?.text, "second turn");
assert.equal(second.at(-1)?.steps, 1, "第二轮不该再要工具");

assert.equal(await kernel.shutdown("kernel_exit"), 0, "干净关机的退出码是 0");
console.log(`\n插件日志 ${logs.length} 条，最后几条:`);
for (const line of logs.slice(-6)) console.log(`  ${line}`);
console.log("\n对话过了: capabilities / tools.list / skill.list / tool.shell.run / agent.loop(两轮) / shutdown");
