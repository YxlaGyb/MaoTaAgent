import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture as fixtureBin, kernel as kernelBin } from "eggshell-kernel";

import { boot, KernelError, type Chunk, type Event } from "../src/index.ts";

const [eggshellArg, fixtureArg] = process.argv.slice(2);
const eggshell = eggshellArg ?? kernelBin;
const fixture = fixtureArg ?? fixtureBin;
if (!eggshell || !fixture) {
  throw new Error("usage: node packages/boot/host/tests/bridge.smoke.ts [eggshell] [eggshell-fixture] (defaults to node_modules/eggshell-kernel/bin)");
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function nextMatching(events: AsyncIterator<Event>, topic: string): Promise<Event> {
  for (;;) {
    const next = await Promise.race([
      events.next(),
      sleep(5000).then(() => Promise.reject(new Error(`timed out waiting for ${topic}`))),
    ]);
    if (next.done) throw new Error(`the event stream ended before ${topic} arrived`);
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

const table = await kernel.capabilities();
assert.equal(table["demo.text"]?.plugin, "provider", "能力表里应该有 demo.text");
assert.equal(table["demo.text"]?.version, "1.0.0");

const echoed = (await kernel.invoke("demo.text", "echo", { hi: 1 })) as { got: { hi: number } };
assert.equal(echoed.got.hi, 1);
await assert.rejects(
  kernel.invoke("demo.nope", "echo"),
  (error: unknown) => error instanceof KernelError && error.code === -32010,
);

const chunks: Chunk[] = [];
for await (const chunk of await kernel.invoke("demo.text", "chat", {}, { stream: true })) chunks.push(chunk);
assert.deepEqual(chunks.map((chunk) => chunk.seq), [0, 1, 2, 3]);
assert.deepEqual(chunks[2]!.data, { delta: "c2" });
assert.equal(chunks[3]!.done, true);
assert.equal(chunks[3]!.data, null);

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

const events = kernel.subscribe(["kernel.plugin.*"])[Symbol.asyncIterator]();
const viaOn: string[] = [];
const off = kernel.on(["kernel.plugin.*"], (event) => viaOn.push(event.topic));
await tick();
await kernel.invoke("demo.text", "echo", {});

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

console.log("bridge ok: boot / capabilities / invoke / stream / cancel / subscribe / on / shutdown(reason)");
