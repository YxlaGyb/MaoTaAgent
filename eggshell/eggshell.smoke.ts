// 这座桥能不能真跑起来: 起一个真内核 + 真替身插件，每个方法过一遍。
//
// 先在 eggshellmod 里构建内核与替身:
//   cargo build -p eggshell-kernel --features fixture,host
// 再跑（Node 26 直接吃 .ts）:
//   node eggshell.smoke.ts <eggshell.exe> <eggshell-fixture.exe>
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture as fixtureBin, kernel as kernelBin } from "eggshell-kernel";

import { boot, KernelError, type Chunk, type Event } from "./eggshell.ts";

// 缺省用 pnpm install 装进来的那一对；也可以显式给路径。
const [eggshellArg, fixtureArg] = process.argv.slice(2);
const eggshell = eggshellArg ?? kernelBin;
const fixture = fixtureArg ?? fixtureBin;
if (!eggshell || !fixture) {
  throw new Error("用法: node eggshell.smoke.ts [eggshell] [eggshell-fixture]（缺省用 node_modules/eggshell-kernel/bin 里的）");
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function nextMatching(events: AsyncIterator<Event>, topic: string): Promise<Event> {
  for (;;) {
    const next = await Promise.race([
      events.next(),
      sleep(5000).then(() => Promise.reject(new Error(`等 ${topic} 超时`))),
    ]);
    if (next.done) throw new Error(`事件流提前结束，没等到 ${topic}`);
    if (next.value.topic === topic) return next.value;
  }
}

const dir = mkdtempSync(join(tmpdir(), "maota-bridge-"));
const config = join(dir, "eggshell.toml");
writeFileSync(
  config,
  `
[plugins.provider]
command = '${fixture}'
args = ["--provides", "demo.text=1.0.0", "--chunks", "3"]

[plugins.doomed]
command = '${fixture}'
args = ["--provides", "demo.other=1.0.0", "--exit-on-invoke"]
`,
);

const logs: string[] = [];
const kernel = await boot(config, {
  bin: eggshell,
  onLog: (line) => logs.push(String(line.message ?? "")),
});

// capabilities
const table = await kernel.capabilities();
assert.equal(table["demo.text"]?.plugin, "provider", "能力表里应该有 demo.text");
assert.equal(table["demo.text"]?.version, "1.0.0");

// invoke: 一问一答，外加一个内核回的错
const echoed = (await kernel.invoke("demo.text", "echo", { hi: 1 })) as { got: { hi: number } };
assert.equal(echoed.got.hi, 1);
await assert.rejects(
  kernel.invoke("demo.nope", "echo"),
  (error: unknown) => error instanceof KernelError && error.code === -32010,
);

// 流: 3 块 + 1 个终止块，seq 由内核重编号
const chunks: Chunk[] = [];
for await (const chunk of await kernel.invoke("demo.text", "chat", {}, { stream: true })) chunks.push(chunk);
assert.deepEqual(chunks.map((chunk) => chunk.seq), [0, 1, 2, 3]);
assert.deepEqual(chunks[2]!.data, { delta: "c2" });
assert.equal(chunks[3]!.done, true);
assert.equal(chunks[3]!.data, null);

// break 即取消: 消费一块就走，内核该给插件发 $/cancel
const one: Chunk[] = [];
for await (const chunk of await kernel.invoke("demo.text", "chat", {}, { stream: true })) {
  one.push(chunk);
  break;
}
assert.equal(one.length, 1, "break 之前只收到一块");
for (let i = 0; i < 100 && !logs.some((line) => line.includes("fixture: cancelled request=")); i += 1) await sleep(20);
assert.ok(
  logs.some((line) => line.includes("fixture: cancelled request=")),
  "break 出流以后内核应该给插件发 $/cancel",
);

// 事件: subscribe 拿迭代器，on 拿回调；同一图案 → 内核那边只有一个订阅
const events = kernel.subscribe(["kernel.plugin.*"])[Symbol.asyncIterator]();
const viaOn: string[] = [];
const off = kernel.on(["kernel.plugin.*"], (event) => viaOn.push(event.topic));
await tick(); // 让 subscribe 帧先上路
await kernel.invoke("demo.text", "echo", {}); // 它回来时订阅肯定已经在内核里

const refused = (await kernel.invoke("demo.other", "echo").catch((error: unknown) => error)) as KernelError;
assert.equal(refused.code, -32011, "提供方死了以后这个能力槽报 -32011");
const event = await nextMatching(events, "kernel.plugin.degraded");
assert.equal((event.payload as { plugin: string }).plugin, "doomed");
assert.ok(viaOn.includes("kernel.plugin.degraded"), "on 那条路也该收到同一个事件");

off();
await events.return?.(undefined);
assert.equal(await kernel.shutdown("kernel_exit"), 0, "干净关机的退出码是 0");
await sleep(50);
assert.ok(
  logs.some((line) => line.includes("fixture: shutdown reason=kernel_exit")),
  "宿主挑的 reason 该传到插件",
);

console.log("桥过了: boot / capabilities / invoke / stream / cancel / subscribe / on / shutdown(reason)");
