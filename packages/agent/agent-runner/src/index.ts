#!/usr/bin/env node
import {
  CallError,
  isPluginEntry,
  runPlugin,
  type Call,
  type Channel,
  type Definition,
} from "@maota/plugin-kit";

import { TurnQueue } from "./queue.ts";
import { executeTurn } from "./run.ts";
import { asTurnInput, jobNotice } from "./sources.ts";
import { runSelfCheck } from "./selfcheck.ts";
import type { TurnEvent, TurnInput } from "./types.ts";

const DEFAULTS = {
  max_parallel_turns: 2,
  max_system_turns: 1,
  max_consecutive_wakes: 3,
};

let settings = { ...DEFAULTS };
let runner: TurnQueue | null = null;
let channel: Channel | null = null;
let subscription: string | null = null;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function publish(event: TurnEvent): void {
  void channel?.publish(`agent.turn.${event.type}`, event).catch(() => undefined);
}

function requireRunner(): TurnQueue {
  if (runner === null) throw new CallError(-32603, "agent.runner is not started");
  return runner;
}


export const definition: Definition = {
  provides: ["agent.runner"],
  requires: [{ capability: "agent.loop" }, { capability: "jobs", optional: true }, { capability: "permission", optional: true }],
  configKeys: ["max_parallel_turns", "max_system_turns", "max_consecutive_wakes"],

  setup(wiring) {
    settings = {
      max_parallel_turns: positive(wiring.config.max_parallel_turns, DEFAULTS.max_parallel_turns),
      max_system_turns: positive(wiring.config.max_system_turns, DEFAULTS.max_system_turns),
      max_consecutive_wakes: positive(wiring.config.max_consecutive_wakes, DEFAULTS.max_consecutive_wakes),
    };
  },

  async start(wiring) {
    channel = wiring.channel;
    runner = new TurnQueue(
      { maxParallel: settings.max_parallel_turns, maxSystem: settings.max_system_turns, wakeBudget: settings.max_consecutive_wakes },
      (entry, signal) => executeTurn(wiring.channel, entry, signal),
    );
    subscription = await wiring.channel.subscribe(["jobs.settled"], (_topic, _seq, payload) => {
      const raw = (payload ?? {}) as Record<string, unknown>;
      if (raw.awaited === true || typeof raw.owner !== "string" || raw.owner === "") return;
      const id = String(raw.id ?? "");
      if (id === "") return;
      const input: TurnInput = {
        session_id: raw.owner,
        cwd: typeof raw.cwd === "string" ? raw.cwd : "",
        input: jobNotice(raw),
        source: { kind: "job", id, title: typeof raw.label === "string" ? raw.label : undefined },
      };
      requireRunner().submit(input, true, publish);
    });
  },

  methods: {
    async send(params, call: Call) {
      if (call.stream === undefined) throw new CallError(-32602, "agent.runner.send is streaming");
      const input = asTurnInput(params);
      if (input.source.kind !== "user") throw new CallError(-32602, "send accepts only user source");
      const submission = requireRunner().submit(input, true, (event) => call.stream?.push(event), call.signal);
      if (submission.state !== "started") {
        call.stream.push({ type: "queued", turn_id: submission.turn_id, session_id: input.session_id, source: input.source });
      }
      await submission.done;
    },

    async deliver(params) {
      const raw = (params ?? {}) as Record<string, unknown>;
      const input = asTurnInput(raw);
      if (input.source.kind === "user") throw new CallError(-32602, "deliver accepts only job or schedule source");
      const submission = requireRunner().submit(input, raw.wake !== false, publish);
      if (raw.wait === true) return await submission.done;
      return { turn_id: submission.turn_id, state: submission.state };
    },

    cancel(params) {
      const id = String((params as { turn_id?: unknown } | null)?.turn_id ?? "");
      if (id === "" || !requireRunner().cancel(id)) throw new CallError(-32602, `unknown turn_id ${JSON.stringify(id)}`);
      return { cancelled: true };
    },

    status(params) {
      const session = String((params as { session_id?: unknown } | null)?.session_id ?? "");
      if (session === "") throw new CallError(-32602, "session_id is required");
      return requireRunner().status(session);
    },
  },

  async close() {
    if (channel !== null && subscription !== null) await channel.unsubscribe(subscription).catch(() => undefined);
    subscription = null;
    runner = null;
  },

  async selfCheck() {
    return await runSelfCheck();
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);