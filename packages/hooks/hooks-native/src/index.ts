#!/usr/bin/env node
import {
  CallError,
  isPluginEntry,
  runPlugin,
  type Call,
  type Channel,
  type Definition,
  type Route,
  type Wiring,
} from "@maota/plugin-kit";
import { HOOK_EVENTS, isHookEvent, mergeHookOutcomes, type HookOutcome } from "@maota/hook-protocol";
import { runCommandHooks, type CommandHook } from "./command.ts";
import {
  collectHookContributions,
  describeProviders,
  providerCapabilities,
  runHooks,
  type HookProvider,
} from "./engine.ts";

const DEFAULTS = { max_context_chars: 4000, parallel: true, strict: true };

let settings = { ...DEFAULTS };
let providers: HookProvider[] = [];
/// Command hooks grouped by the registration that owns them, because a scope is
/// how a run that borrowed them gives them back.
let commands = new Map<string, CommandHook[]>();
/// Nothing here outlives the process; the controller exists so a discovery call
/// still in flight when the kernel says goodbye stops with it.
const life = new AbortController();

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readCommandHooks(value: unknown, scope: string): CommandHook[] {
  if (!Array.isArray(value)) throw new CallError(-32602, "hooks must be a list");
  const hooks: CommandHook[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CallError(-32602, "each hook must be an object with an event and a command");
    }
    const input = raw as Record<string, unknown>;
    if (!isHookEvent(input.event)) {
      throw new CallError(-32602, `each hook needs an event from ${HOOK_EVENTS.join(", ")}`);
    }
    if (typeof input.command !== "string" || input.command.trim() === "") {
      throw new CallError(-32602, "each hook needs a command");
    }
    const matcher = input.matcher;
    if (matcher !== undefined && typeof matcher !== "string") {
      throw new CallError(-32602, "a hook matcher must be a string");
    }
    const timeout = input.timeout_ms;
    if (timeout !== undefined && !(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)) {
      throw new CallError(-32602, "a hook timeout_ms must be a positive number");
    }
    hooks.push({
      event: input.event,
      command: input.command,
      scope,
      ...(matcher === undefined ? {} : { matcher }),
      ...(timeout === undefined ? {} : { timeout_ms: Math.floor(timeout) }),
    });
  }
  return hooks;
}

function allCommands(): CommandHook[] {
  return [...commands.values()].flat();
}

async function discover(channel: Channel, capabilities: Record<string, Route>): Promise<void> {
  providers = await describeProviders(channel, capabilities, life.signal, settings.strict);
}

export const definition: Definition = {
  provides: ["hooks"],
  configKeys: ["max_context_chars", "command_hooks", "parallel", "strict"],

  setup(wiring) {
    settings = {
      max_context_chars: positive(wiring.config.max_context_chars, DEFAULTS.max_context_chars),
      parallel: flag(wiring.config.parallel, DEFAULTS.parallel),
      strict: flag(wiring.config.strict, DEFAULTS.strict),
    };
  },

  async start(wiring) {
    // A profile that lists its own command hooks hands them over here, and they
    // are owned the same way a skill's are, under a scope named for the config.
    const listed = wiring.config.command_hooks;
    if (listed !== undefined) commands.set("config", readCommandHooks(listed, "config"));
    await discover(wiring.channel, { ...wiring.capabilities });
    wiring.channel.log("info", `hooks: ${providers.map((item) => item.capability).join(", ") || "(none)"}`, {
      count: providers.length,
    });
    // The table handed over at start is a snapshot, and a hook may be mounted,
    // restarted or dropped later; the kernel publishes every change, so no row
    // order is load-bearing here.
    await wiring.channel.subscribe(["kernel.capabilities.changed"], (_topic, _seq, payload) => {
      const table = (payload as { capabilities?: Record<string, Route> } | null)?.capabilities;
      if (table === undefined || table === null) return;
      void discover(wiring.channel, table)
        .then(() => undefined)
        .catch(() => undefined);
    });
  },

  methods: {
    async trigger(params, ctx) {
      const event = params?.event;
      if (!isHookEvent(event)) {
        throw new CallError(-32602, `event must be one of ${HOOK_EVENTS.join(", ")}`);
      }
      const payload = params?.payload ?? null;
      // Providers and commands are both opinions about the same event and fold
      // the same way, so a command hook can refuse exactly where a plugin can.
      // The two groups are asked at the same time and folded providers first,
      // each group in its own registration order.
      const [fromPlugins, fromCommands] = await Promise.all([
        collectHookContributions(ctx.channel, ctx.signal, event, payload, providers, settings.parallel),
        runCommandHooks(allCommands(), event, payload, ctx.signal, (level, message, fields) =>
          ctx.channel.log(level, message, fields),
        ),
      ]);
      const contributions = [...fromPlugins, ...fromCommands];
      const outcome = mergeHookOutcomes(contributions, event, settings.max_context_chars);
      ctx.channel.log("info", `${event}: ${outcome.decision ?? "no opinion"}`, {
        event,
        answered: contributions.map((contribution) => contribution.source),
      });
      return outcome;
    },

    list() {
      return {
        hooks: providers.map((item) => ({ capability: item.capability, events: item.events })),
        commands: allCommands().map((hook) => ({
          event: hook.event,
          command: hook.command,
          scope: hook.scope,
          ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
        })),
      };
    },

    /// A skill registers its hooks for one run and takes them back when that
    /// run ends; the scope is what it takes back, so two skills that register
    /// the same command never withdraw each other.
    register(params) {
      const scope = params?.scope;
      if (typeof scope !== "string" || scope.trim() === "") {
        throw new CallError(-32602, "register needs a scope");
      }
      const hooks = readCommandHooks(params?.hooks ?? [], scope);
      commands.set(scope, hooks);
      return { registered: hooks.length, scope };
    },

    unregister(params) {
      const scope = params?.scope;
      if (typeof scope !== "string" || scope.trim() === "") {
        throw new CallError(-32602, "unregister needs a scope");
      }
      const removed = commands.get(scope)?.length ?? 0;
      commands.delete(scope);
      return { removed, scope };
    },
  },

  close() {
    life.abort();
    commands = new Map<string, CommandHook[]>();
  },

  async selfCheck() {
    const problems: string[] = [];
    const notes: string[] = [];
    const signal = new AbortController().signal;
    const table = {
      "hook.alpha": { plugin: "alpha" },
      "hook.beta": { plugin: "beta" },
      tools: { plugin: "tools" },
    } as unknown as Record<string, Route>;

    const watchers: Array<(topic: string, seq: number, payload: unknown) => void> = [];
    const fake = (handlers: Record<string, (method: string) => unknown>): Channel =>
      ({
        call: async (capability: string, method: string) => {
          const handler = handlers[capability];
          if (handler === undefined) throw new Error(`no such capability: ${capability}`);
          return handler(method);
        },
        log: (_level: string, message: string) => {
          notes.push(message);
        },
        subscribe: async (
          _patterns: readonly string[],
          handler: (topic: string, seq: number, payload: unknown) => void,
        ) => {
          watchers.push(handler);
          return "s-1";
        },
      }) as unknown as Channel;

    const handlers: Record<string, (method: string) => unknown> = {
      "hook.alpha": (method) => {
        if (method === "describe") return { events: ["PreToolUse", "Stop"] };
        if (method === "PreToolUse") return { decision: "deny", reason: "alpha says no", context: ["one", "two"] };
        if (method === "Stop") return { steer: "keep going" };
        throw new Error(`alpha was asked for ${method}`);
      },
      "hook.beta": (method) => {
        if (method === "describe") return { events: ["PreToolUse"] };
        if (method === "PreToolUse") return { decision: "allow", context: ["three"] };
        throw new Error(`beta was asked for ${method}`);
      },
    };
    const alphaBeta = fake(handlers);

    if (providerCapabilities(table).join(",") !== "hook.alpha,hook.beta") {
      problems.push(`providerCapabilities picked ${providerCapabilities(table).join(",")}`);
    }

    const found = await describeProviders(alphaBeta, table, signal, false);
    if (found.map((item) => item.capability).join(",") !== "hook.alpha,hook.beta") {
      problems.push(`describeProviders found ${found.map((item) => item.capability).join(",")}`);
    }

    const refusal = await runHooks(alphaBeta, signal, "PreToolUse", { tool: "pwsh" }, 4000, found);
    if (refusal.decision !== "deny") problems.push("an allow overrode a refusal");
    if (refusal.reason !== "alpha says no") problems.push(`the refusal reason came out as ${String(refusal.reason)}`);
    if ((refusal.context ?? []).map((note) => note.text).join(",") !== "one,two,three") {
      problems.push("context did not accumulate in hook order");
    }
    if ((refusal.context ?? []).map((note) => note.source).join(",") !== "hook:alpha,hook:alpha,hook:beta") {
      problems.push(`context was stamped with ${(refusal.context ?? []).map((note) => note.source).join(",")}`);
    }

    const stopped = await runHooks(alphaBeta, signal, "Stop", { steps: 1 }, 4000, found);
    if (stopped.steer !== "keep going") problems.push("a declared event did not reach its hook");
    const prompt = await runHooks(alphaBeta, signal, "UserPromptSubmit", { input: "hi" }, 4000, found);
    if (prompt.decision !== undefined || prompt.steer !== undefined) {
      problems.push("a hook that declared no such event still answered");
    }

    const clipped = await runHooks(alphaBeta, signal, "PreToolUse", {}, 2, found);
    if (clipped.context?.[0]?.text !== "on…") problems.push(`clipping produced ${String(clipped.context?.[0]?.text)}`);

    const broken = fake({
      "hook.alpha": () => {
        throw new Error("alpha is broken");
      },
      "hook.beta": (method) => {
        if (method === "describe") return { events: ["PreToolUse"] };
        if (method === "PreToolUse") return { decision: "deny", reason: "beta says no" };
        throw new Error(`beta was asked for ${method}`);
      },
    });
    const survivors = await describeProviders(broken, table, signal, false);
    if (survivors.map((item) => item.capability).join(",") !== "hook.beta") {
      problems.push(`a hook with no usable describe was not skipped: ${survivors.map((i) => i.capability).join(",")}`);
    }
    // Strict is the default, and the same broken hook is what it refuses: a
    // capability that cannot be read is a startup failure, not a silent drop.
    let strict = "";
    try {
      await describeProviders(broken, table, signal);
    } catch (error) {
      strict = error instanceof Error ? error.message : String(error);
    }
    if (!strict.includes("hook.alpha has no usable describe")) {
      problems.push(`a strict discovery answered ${JSON.stringify(strict)}`);
    }
    const survived = await runHooks(broken, signal, "PreToolUse", {}, 4000, survivors);
    if (survived.decision !== "deny") problems.push("a failing hook swallowed the other hook's refusal");

    const silent = fake({ "hook.alpha": () => ({ events: [] }), "hook.beta": () => ({ events: ["Stop"] }) });
    const declared = await describeProviders(silent, table, signal, false);
    if (declared.map((item) => item.capability).join(",") !== "hook.beta") {
      problems.push("a hook that declares no event was kept");
    }
    if (notes.length === 0) problems.push("nothing was logged while hooks were skipped");

    const changed = { "hook.gamma": { plugin: "gamma" } } as unknown as Record<string, Route>;
    const rebuilt = await describeProviders(fake({ "hook.gamma": () => ({ events: ["Stop"] }) }), changed, signal, false);
    if (rebuilt.map((item) => item.capability).join(",") !== "hook.gamma") {
      problems.push("a changed capability table did not rebuild the provider list");
    }

    const changing = fake({
      ...handlers,
      "hook.gamma": (method) => (method === "describe" ? { events: ["Stop"] } : { steer: "on" }),
    });
    const wiring = { channel: changing, config: {}, capabilities: table } as unknown as Wiring;
    await definition.start?.(wiring);
    const listed = definition.methods.list?.({}, {} as Call) as { hooks?: Array<{ capability: string }> };
    if ((listed?.hooks ?? []).map((hook) => hook.capability).join(",") !== "hook.alpha,hook.beta") {
      problems.push(`list reported ${JSON.stringify(listed)}`);
    }
    const triggered = (await definition.methods.trigger?.(
      { event: "PreToolUse", payload: { tool: "pwsh" } },
      { ...wiring, signal } as unknown as Call,
    )) as HookOutcome;
    if (triggered.decision !== "deny" || triggered.reason !== "alpha says no") {
      problems.push(`trigger returned ${JSON.stringify(triggered)}`);
    }
    if (watchers.length !== 1) problems.push(`the engine subscribed ${watchers.length} times`);
    for (const watcher of watchers) watcher("kernel.capabilities.changed", 1, { capabilities: changed });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rebuiltList = definition.methods.list?.({}, {} as Call) as { hooks?: Array<{ capability: string }> };
    if ((rebuiltList?.hooks ?? []).map((hook) => hook.capability).join(",") !== "hook.gamma") {
      problems.push(`capabilities.changed did not rebuild the list: ${JSON.stringify(rebuiltList)}`);
    }

    let refused = "";
    try {
      await definition.methods.trigger?.({ event: "Nope" }, {} as Call);
    } catch (error) {
      refused = error instanceof CallError ? "call error" : `wrong error: ${String(error)}`;
    }
    if (refused !== "call error") problems.push(`an unknown event was accepted (${refused})`);

    const outcome: HookOutcome = refusal;
    if (outcome.context === undefined) problems.push("the merged outcome lost its context");
    return problems;
  },
};

/// This package is spawned as the hook engine and imported by nothing else, but
/// a check that imports it to exercise a method must not start a server.
if (isPluginEntry(import.meta.url)) runPlugin(definition);
