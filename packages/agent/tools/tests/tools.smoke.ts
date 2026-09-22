import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { packageVersion, type Call, type Channel, type Route } from "@maota/plugin-kit";

import { definition } from "../src/index.ts";

const setup = definition.setup!;
const start = definition.start!;
const close = definition.close!;
const selfCheck = definition.selfCheck!;
const list = definition.methods.list!;
const call = definition.methods.call!;
const classify = definition.methods.classify!;

const echo = {
  name: "echo",
  description: "echo back",
  input_schema: { type: "object", properties: {} },
  host_args: [],
};

interface Harness {
  channel: Channel;
  asked: string[];
  notes: string[];
  listeners: Array<(topic: string, seq: number, payload: unknown) => void>;
}

/// A channel that answers `tool.*` calls out of a table, remembers what it was
/// asked, and hands the test the subscriptions the dispatcher made so a
/// capability change can be delivered the way the kernel delivers one.
function harness(
  handlers: Record<string, (method: string, payload: unknown) => unknown>,
): Harness {
  const asked: string[] = [];
  const notes: string[] = [];
  const listeners: Harness["listeners"] = [];
  const channel = {
    call: async (capability: string, method: string, payload: unknown) => {
      asked.push(`${capability}/${method}`);
      const handler = handlers[capability];
      if (handler === undefined) throw new Error(`no such capability: ${capability}`);
      return handler(method, payload);
    },
    log: (_level: string, message: string) => {
      notes.push(message);
    },
    subscribe: async (_patterns: readonly string[], handler: Harness["listeners"][number]) => {
      listeners.push(handler);
      return `sub-${listeners.length}`;
    },
    unsubscribe: async () => undefined,
  } as unknown as Channel;
  return { channel, asked, notes, listeners };
}

function context(found: Harness, method: string): Call {
  return {
    channel: found.channel,
    config: {},
    capabilities: {},
    capability: "tools",
    method,
    caller: "agent-core",
    signal: new AbortController().signal,
    stream: undefined,
  } as unknown as Call;
}

const dir = mkdtempSync(join(tmpdir(), "maota-tools-"));
const spillDir = join(dir, "spill");
const table: Record<string, Route> = { "tool.echo": { plugin: "echo", version: "1.0.0" }, api: { plugin: "api", version: "1.0.0" } };

let policy: unknown = { concurrency: "always" };
let result: unknown = "done";
const found = harness({
  "tool.echo": (method) => {
    if (method === "describe") return echo;
    if (method === "policy") return policy;
    if (method === "classify") return { safe: true };
    return result;
  },
  "tool.bad": () => {
    throw new Error("no describe");
  },
});

const wiring = { channel: found.channel, config: { spill_dir: spillDir, preview_chars: 40 }, capabilities: table };
setup(wiring);
await start(wiring);

assert.equal(definition.provides[0]?.version, packageVersion(import.meta.url));
assert.deepEqual(found.listeners.length, 1);

const listed = (await list({}, context(found, "list"))) as { tools: Array<{ name: string }> };
assert.deepEqual(
  listed.tools.map((tool) => tool.name),
  ["echo"],
  "list picked a tool that is not tool.*",
);

/// A tool that cannot describe itself is left out with a warning rather than
/// failing the whole list.
found.listeners[0]?.("kernel.capabilities.changed", 1, {
  capabilities: { "tool.bad": { plugin: "bad", version: "1.0.0" }, "tool.echo": table["tool.echo"] },
});
const afterChange = (await list({}, context(found, "list"))) as { tools: Array<{ name: string }> };
assert.deepEqual(afterChange.tools.map((tool) => tool.name), ["echo"], "list did not follow the new table");
assert.ok(found.notes.some((note) => note.includes("bad")), "a broken tool was dropped silently");

found.listeners[0]?.("kernel.capabilities.changed", 2, { capabilities: {} });
assert.deepEqual((await list({}, context(found, "list"))) as unknown, { tools: [] });
found.listeners[0]?.("kernel.capabilities.changed", 3, { capabilities: table });

await assert.rejects(async () => await call({ name: "absent" }, context(found, "call")), /no such tool: absent/);
await assert.rejects(async () => await classify({ name: "absent" }, context(found, "classify")), /no such tool: absent/);

/// A tool that declares no budget is bounded by the config, and a result inside
/// the budget comes back as it was.
assert.equal(await call({ name: "echo" }, context(found, "call")), "done");

/// A policy is read per call, so a tool that lowers its budget between two calls
/// is believed the second time rather than the first.
policy = { concurrency: "always", max_result_chars: 5 };
result = "abcdefghij";
const spilled = (await call({ name: "echo" }, context(found, "call"))) as {
  spilled: boolean;
  path: string;
  chars: number;
  preview: string;
};
assert.equal(spilled.spilled, true);
assert.equal(spilled.chars, 10);
assert.equal(spilled.preview, "abcde");
assert.equal(readFileSync(spilled.path, "utf8"), "abcdefghij");

/// Never spilling is a declared `null` and not a missing budget.
policy = { concurrency: "always", max_result_chars: null };
assert.equal(await call({ name: "echo" }, context(found, "call")), "abcdefghij");

/// `classify` answers from the current policy: a tool that becomes unsafe
/// between calls is refused on the second one.
policy = { concurrency: "always" };
assert.deepEqual(await classify({ name: "echo" }, context(found, "classify")), { safe: true });
policy = { concurrency: "never" };
assert.deepEqual(await classify({ name: "echo" }, context(found, "classify")), { safe: false });
policy = { concurrency: "args" };
assert.deepEqual(await classify({ name: "echo" }, context(found, "classify")), { safe: true });
policy = null;
assert.deepEqual(await classify({ name: "echo" }, context(found, "classify")), { safe: false });

/// A sweep drops what is past its age and trims the rest down to the byte cap.
policy = { concurrency: "always", max_result_chars: 5 };
const sweepDir = join(dir, "sweep");
setup({ channel: found.channel, config: { spill_dir: sweepDir, preview_chars: 40, spill_max_bytes: 12 }, capabilities: table });
mkdirSync(sweepDir, { recursive: true, mode: 0o700 });
const stale = join(sweepDir, "stale.txt");
writeFileSync(stale, "old", { mode: 0o600 });
const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
utimesSync(stale, past, past);
const first = ((await call({ name: "echo" }, context(found, "call"))) as { path: string }).path;
assert.equal(existsSync(stale), false, "the sweep kept a result past its age");
assert.equal(readdirSync(sweepDir).length, 1, "the sweep left more than the fresh result");

/// The sweep runs before the write, so the file that goes over the cap is the
/// one already on disk when the next result arrives.
const second = ((await call({ name: "echo" }, context(found, "call"))) as { path: string }).path;
assert.equal(existsSync(first), true, "the sweep dropped a result that still fitted");
await call({ name: "echo" }, context(found, "call"));
assert.equal(existsSync(first), false, "the sweep did not trim down to the byte cap");
assert.equal(existsSync(second), true, "the sweep dropped the newest result");

close("done");

const problems = (await selfCheck()) ?? [];
assert.deepEqual(problems, [], problems.join("; "));

rmSync(dir, { recursive: true, force: true });
console.log("tools.smoke: ok");
