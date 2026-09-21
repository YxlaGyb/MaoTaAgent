import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { Channel, Route } from "@maota/plugin-kit";
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
  "hook.alpha": { plugin: "alpha", version: "1.0.0" },
  "hook.beta": { plugin: "beta", version: "1.0.0" },
  "hook.": { plugin: "nameless", version: "1.0.0" },
  hooks: { plugin: "hooks", version: "1.0.0" },
  tools: { plugin: "tools", version: "1.0.0" },
} as unknown as Record<string, Route>;

const signal = new AbortController().signal;

assert.deepEqual([...HOOK_EVENTS], ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);
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

assert.deepEqual(providerCapabilities(table), ["hook.alpha", "hook.beta"], "only hook.* names are picked, in order");

const found = fake({
  "hook.alpha": (method) =>
    method === "describe" ? { events: ["PreToolUse", "Stop"] } : { decision: "deny", reason: "alpha says no" },
  "hook.beta": () => {
    throw new Error("beta cannot say");
  },
});
const providers = await describeProviders(found.channel, table, signal);
assert.deepEqual(providers, [{ capability: "hook.alpha", events: ["PreToolUse", "Stop"] }]);
assert.deepEqual(found.asked, ["hook.alpha/describe", "hook.beta/describe"], "the table is asked in name order");
assert.equal(found.notes.length, 1, "a hook that cannot answer is logged");

const silent = fake({
  "hook.alpha": () => ({ events: [] }),
  "hook.beta": () => ({ events: ["Nope", "Stop"] }),
});
assert.deepEqual(
  await describeProviders(silent.channel, table, signal),
  [{ capability: "hook.beta", events: ["Stop"] }],
  "an unknown event is dropped, and a hook left with none is not a hook",
);
assert.equal(silent.notes.length, 1);

const shapeless = fake({ "hook.alpha": () => ({ events: "Stop" }), "hook.beta": () => null });
assert.deepEqual(await describeProviders(shapeless.channel, table, signal), []);
assert.equal(shapeless.notes.length, 2, "a describe that names no event is logged, not obeyed");

const spread = fake({
  "hook.alpha": (method, payload) =>
    method === "describe"
      ? { events: ["PreToolUse", "Stop"] }
      : { decision: "deny", reason: `alpha saw ${JSON.stringify(payload)}` },
  "hook.beta": (method) => (method === "describe" ? { events: ["Stop"] } : { steer: "later" }),
});
const listeners = await describeProviders(spread.channel, table, signal);
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
const survivors = await describeProviders(broken.channel, table, signal);
assert.deepEqual(survivors, [{ capability: "hook.beta", events: ["PreToolUse"] }]);
const survived = await runHooks(broken.channel, signal, "PreToolUse", {}, 4000, survivors);
assert.equal(survived.reason, "beta says no", "a hook that failed does not swallow another hook's refusal");
assert.equal(broken.notes.length, 2, "the skipped hook and the answered event are both logged");

const mute = fake({ "hook.alpha": (method) => (method === "describe" ? { events: ["Stop"] } : null) });
const mutes = await describeProviders(mute.channel, table, signal);
assert.deepEqual(
  await runHooks(mute.channel, signal, "Stop", {}, 4000, mutes),
  {},
  "a hook with nothing to say contributes nothing",
);

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
const report = JSON.parse(line) as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the hooks entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the hooks selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "hooks", version: "1.0.0" }]);

console.log("hooks ok: the dialect, the merge, discovery, fan out, failure paths, the entry --check report");
