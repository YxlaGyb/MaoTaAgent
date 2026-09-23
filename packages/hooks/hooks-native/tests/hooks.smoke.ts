import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Channel, type Route } from "@maota/plugin-kit";
import {
  HOOK_EVENTS,
  clipContext,
  hookLabel,
  isHookCapability,
  isHookEvent,
  mergeHookOutcomes,
} from "@maota/hook-protocol";

import { describeProviders, providerCapabilities, runHooks } from "../src/engine.ts";

interface Fake {
  channel: Channel;
  asked: string[];
  notes: string[];
}

/// A channel that answers `hook.*` calls out of a table and remembers what it
/// was asked, so a test can tell a hook that was skipped from one that simply
/// never heard the event.
function fake(handlers: Record<string, (method: string, payload: unknown) => unknown>): Fake {
  const asked: string[] = [];
  const notes: string[] = [];
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
  } as unknown as Channel;
  return { channel, asked, notes };
}

const table = {
  "hook.alpha": { plugin: "alpha" },
  "hook.beta": { plugin: "beta" },
  "hook.": { plugin: "nameless" },
  hooks: { plugin: "hooks" },
  tools: { plugin: "tools" },
} as unknown as Record<string, Route>;

const signal = new AbortController().signal;

assert.deepEqual([...HOOK_EVENTS], [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreModel",
  "PostModel",
  "PreCompact",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
]);
assert.equal(isHookEvent("PostToolUse"), true);
assert.equal(isHookEvent("posttooluse"), false, "an event name is matched exactly");
assert.equal(isHookEvent(undefined), false);
assert.equal(isHookCapability("hook.deny-secrets"), true);
assert.equal(isHookCapability("hook."), false, "a bare prefix names no hook");
assert.equal(isHookCapability("hooks"), false, "the engine's own capability is not a hook");
assert.equal(isHookCapability("tool.pwsh"), false);
assert.equal(hookLabel("hook.deny-secrets"), "hook:deny-secrets");
assert.equal(hookLabel("hook.alpha"), "hook:alpha");

assert.equal(clipContext("  hi  ", 40), "hi");
assert.equal(clipContext("abcdef", 3), "abc…");
assert.equal(clipContext("abc", 0), "");
assert.equal(clipContext("abc", -5), "");

const merged = mergeHookOutcomes(
  [
    { source: "hook:beta", reply: { decision: "allow", context: ["from beta"] } },
    {
      source: "hook:alpha",
      reply: { decision: "deny", reason: "no", context: ["from alpha"], preventContinuation: true, steer: "keep going" },
    },
    { source: "hook:gamma", reply: { decision: "deny", reason: "really no", steer: "second" } },
  ],
  "PreToolUse",
  4000,
);
assert.equal(merged.decision, "deny", "one refusal beats every allowance");
assert.equal(merged.reason, "no\n\nreally no", "only the refusals' reasons survive");
assert.deepEqual(
  merged.context,
  [
    { source: "hook:beta", text: "from beta" },
    { source: "hook:alpha", text: "from alpha" },
  ],
  "context accumulates in hook order and keeps the hook it came from",
);
assert.equal(merged.preventContinuation, true);
assert.equal(merged.steer, "keep going", "the first hook that steers supplies the message");

assert.deepEqual(mergeHookOutcomes([{ source: "hook:alpha", reply: { decision: "allow" } }], "Stop", 4000), {
  decision: "allow",
});
assert.deepEqual(mergeHookOutcomes([], "Stop", 4000), {}, "no contributions is no opinion");
assert.deepEqual(
  mergeHookOutcomes([{ source: "hook:alpha", reply: {} }], "Stop", 4000),
  {},
  "an empty reply is no opinion",
);

const bare = mergeHookOutcomes([{ source: "hook:alpha", reply: { decision: "deny" } }], "PreToolUse", 4000);
assert.equal(bare.reason, "hook:alpha refused this PreToolUse", "a refusal without a reason still says something");

const clipped = mergeHookOutcomes([{ source: "hook:alpha", reply: { context: ["abcdef", "   "] } }], "Stop", 3);
assert.deepEqual(clipped.context, [{ source: "hook:alpha", text: "abc…" }], "blank context is dropped, long text cut");

const blank = mergeHookOutcomes(
  [
    { source: "hook:alpha", reply: { steer: "   " } },
    { source: "hook:beta", reply: { steer: "" } },
  ],
  "Stop",
  4000,
);
assert.equal(blank.steer, undefined, "a blank steer is not a steer");
assert.equal(blank.decision, undefined);

/// A question is weaker than a refusal and stronger than an allowance, and the
/// two fields a decision can carry travel with the first hook that supplied them.
const questioned = mergeHookOutcomes(
  [
    { source: "hook:beta", reply: { decision: "allow", args: { from: "beta" } } },
    { source: "hook:alpha", reply: { decision: "ask", reason: "need a person", output: "rewritten" } },
  ],
  "PreToolUse",
  4000,
);
assert.equal(questioned.decision, "ask", "a question beats an allowance");
assert.equal(questioned.reason, "need a person");
assert.deepEqual(questioned.args, { from: "beta" }, "the first hook that supplies args supplies them");
assert.equal(questioned.output, "rewritten");

const questionedToo = mergeHookOutcomes(
  [
    { source: "hook:alpha", reply: { decision: "ask", reason: "may I" } },
    { source: "hook:beta", reply: { decision: "deny", reason: "no" } },
  ],
  "PreToolUse",
  4000,
);
assert.equal(questionedToo.decision, "deny", "a refusal beats a question");
assert.equal(questionedToo.reason, "no", "only the winner's reasons survive");
assert.equal(
  mergeHookOutcomes([{ source: "hook:alpha", reply: { decision: "ask" } }], "PreToolUse", 4000).reason,
  "hook:alpha asked about this PreToolUse",
  "a question without a reason still says something",
);

assert.deepEqual(providerCapabilities(table), ["hook.alpha", "hook.beta"], "only hook.* names are picked, in order");

const found = fake({
  "hook.alpha": (method) =>
    method === "describe" ? { events: ["PreToolUse", "Stop"] } : { decision: "deny", reason: "alpha says no" },
  "hook.beta": () => {
    throw new Error("beta cannot say");
  },
});
const providers = await describeProviders(found.channel, table, signal, false);
assert.deepEqual(providers, [{ capability: "hook.alpha", events: ["PreToolUse", "Stop"] }]);
assert.deepEqual(found.asked, ["hook.alpha/describe", "hook.beta/describe"], "the table is asked in name order");
assert.equal(found.notes.length, 1, "a hook that cannot answer is logged");

/// Strict is the default, so a hook capability that cannot say what it listens
/// for stops the engine at start rather than being dropped without a word.
await assert.rejects(
  async () => await describeProviders(found.channel, table, signal),
  /hook\.beta has no usable describe/,
);
await assert.rejects(
  async () => await describeProviders(fake({ "hook.alpha": () => ({ events: [] }) }).channel, table, signal),
  /hook\.alpha declares no hook event/,
);

const silent = fake({
  "hook.alpha": () => ({ events: [] }),
  "hook.beta": () => ({ events: ["Nope", "Stop"] }),
});
assert.deepEqual(
  await describeProviders(silent.channel, table, signal, false),
  [{ capability: "hook.beta", events: ["Stop"] }],
  "an unknown event is dropped, and a hook left with none is not a hook",
);
assert.equal(silent.notes.length, 1);

const shapeless = fake({ "hook.alpha": () => ({ events: "Stop" }), "hook.beta": () => null });
assert.deepEqual(await describeProviders(shapeless.channel, table, signal, false), []);
assert.equal(shapeless.notes.length, 2, "a describe that names no event is logged, not obeyed");

const spread = fake({
  "hook.alpha": (method, payload) =>
    method === "describe"
      ? { events: ["PreToolUse", "Stop"] }
      : { decision: "deny", reason: `alpha saw ${JSON.stringify(payload)}` },
  "hook.beta": (method) => (method === "describe" ? { events: ["Stop"] } : { steer: "later" }),
});
const listeners = await describeProviders(spread.channel, table, signal, false);
spread.asked.length = 0;

const refusal = await runHooks(spread.channel, signal, "PreToolUse", { tool: "pwsh" }, 4000, listeners);
assert.equal(refusal.decision, "deny");
assert.equal(refusal.reason, 'alpha saw {"tool":"pwsh"}', "the payload reaches a hook as it is");
assert.deepEqual(spread.asked, ["hook.alpha/PreToolUse"], "a hook that declared no such event never hears it");

spread.asked.length = 0;
const stopped = await runHooks(spread.channel, signal, "Stop", { steps: 1 }, 4000, listeners);
assert.equal(stopped.steer, "later");
assert.deepEqual(spread.asked, ["hook.alpha/Stop", "hook.beta/Stop"], "the hooks are asked in name order");

assert.deepEqual(
  await runHooks(spread.channel, signal, "UserPromptSubmit", {}, 4000, listeners),
  {},
  "an event nobody declared is no opinion",
);

const broken = fake({
  "hook.alpha": () => {
    throw new Error("alpha is down");
  },
  "hook.beta": (method) =>
    method === "describe" ? { events: ["PreToolUse"] } : { decision: "deny", reason: "beta says no" },
});
const survivors = await describeProviders(broken.channel, table, signal, false);
assert.deepEqual(survivors, [{ capability: "hook.beta", events: ["PreToolUse"] }]);
const survived = await runHooks(broken.channel, signal, "PreToolUse", {}, 4000, survivors);
assert.equal(survived.reason, "beta says no", "a hook that failed does not swallow another hook's refusal");
assert.equal(broken.notes.length, 2, "the skipped hook and the answered event are both logged");

const mute = fake({ "hook.alpha": (method) => (method === "describe" ? { events: ["Stop"] } : null) });
const mutes = await describeProviders(mute.channel, table, signal, false);
assert.deepEqual(
  await runHooks(mute.channel, signal, "Stop", {}, 4000, mutes),
  {},
  "a hook with nothing to say contributes nothing",
);

/// Hooks are asked at the same time by default, so one that waits on another
/// does not hold the event up; the answers still fold in hook order.
const order: string[] = [];
let releaseAlpha = (): void => undefined;
const waiting = new Promise<void>((resolve) => {
  releaseAlpha = resolve;
});
const together = fake({
  "hook.alpha": async (method) => {
    if (method === "describe") return { events: ["Stop"] };
    order.push("alpha in");
    await waiting;
    order.push("alpha out");
    return { context: ["from alpha"] };
  },
  "hook.beta": async (method) => {
    if (method === "describe") return { events: ["Stop"] };
    order.push("beta in");
    releaseAlpha();
    return { context: ["from beta"] };
  },
});
const listenersTogether = await describeProviders(together.channel, table, signal, false);
const both = await runHooks(together.channel, signal, "Stop", {}, 4000, listenersTogether);
assert.deepEqual(order, ["alpha in", "beta in", "alpha out"], "the hooks are asked at the same time");
assert.deepEqual(
  both.context?.map((note) => note.text),
  ["from alpha", "from beta"],
  "concurrent answers still fold in hook order",
);

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
const report = JSON.parse(line) as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(run.status, 0, `the hooks entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the hooks selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["hooks"]);

import { definition } from "../src/index.ts";
/// A command hook is a process, not a plugin, and it is what a skill brings
/// with it: registered under a scope, matched on the tool it names, folded with
/// every other opinion, audited, and withdrawn with its scope.
{
  const dir = mkdtempSync(join(tmpdir(), "hooks-cmd-"));
  const home = join(dir, "home");
  process.env.MAOTA_HOME = home;
  const script = join(dir, "hook.mjs");
  writeFileSync(
    script,
    [
      'let raw = "";',
      'process.stdin.on("data", (chunk) => { raw += chunk; });',
      'process.stdin.on("end", () => {',
      "  const { payload } = JSON.parse(raw);",
      '  const verdict = payload.tool === "pwsh" ? { decision: "deny", reason: "no pwsh" } : { context: ["noted"] };',
      "  process.stdout.write(JSON.stringify(verdict));",
      "});",
    ].join("\n"),
  );
  const ctx = {
    channel: { log: () => {} },
    signal: new AbortController().signal,
    capability: "hooks",
  };
  const hooks = definition.methods as unknown as {
    register: (params: any, ctx: unknown) => Promise<{ registered: number }>;
    unregister: (params: any, ctx: unknown) => Promise<{ removed: number }>;
    trigger: (params: any, ctx: unknown) => Promise<{ decision?: string; reason?: string }>;
    list: (params: unknown, ctx: unknown) => Promise<{ commands: unknown[] }>;
  };

  const refused = await hooks.register(
    { scope: "run-1", hooks: [{ event: "PreToolUse", command: `"${process.execPath}" "${script}"`, matcher: "pwsh" }] },
    ctx,
  );
  assert.equal(refused.registered, 1, "a registered command should be counted");

  const unread = await hooks.trigger({ event: "PreToolUse", payload: { tool: "read" } }, ctx);
  assert.equal(unread.decision, undefined, "a matcher that does not match should stay silent");
  const denied = await hooks.trigger({ event: "PreToolUse", payload: { tool: "pwsh" } }, ctx);
  assert.equal(denied.decision, "deny", "a command hook should fold in like any other opinion");
  assert.equal(denied.reason, "no pwsh", `the reason came out as ${String(denied.reason)}`);

  const audit = readFileSync(join(home, "audit", "hooks.jsonl"), "utf8").trim().split("\n");
  assert.equal(audit.length, 1, `only the run that matched should be audited, and ${audit.length} lines say otherwise`);
  const line = JSON.parse(audit[0] ?? "{}") as { scope?: string; decision?: string };
  assert.equal(line.scope, "run-1", "the audit should say which scope ran");
  assert.equal(line.decision, "deny", "the audit should record what the hook decided");

  const gone = await hooks.unregister({ scope: "run-1" }, ctx);
  assert.equal(gone.removed, 1, "a withdrawn scope should say what it withdrew");
  const quiet = await hooks.trigger({ event: "PreToolUse", payload: { tool: "pwsh" } }, ctx);
  assert.equal(quiet.decision, undefined, "a withdrawn hook should not answer");

  const listed = (await hooks.list(undefined, ctx)).commands;
  assert.equal(listed.length, 0, "a withdrawn hook should not be listed");
  rmSync(dir, { recursive: true, force: true });
}

console.log("hooks ok: the dialect, the merge, discovery, fan out, failure paths, the entry --check report, command hooks");
