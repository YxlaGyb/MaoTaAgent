#!/usr/bin/env node
import {
  CallError,
  isPluginEntry,
  runPlugin,
  type Channel,
  type Definition,
} from "@maota/plugin-kit";

import { JobRegistry } from "./registry.ts";
import { runSelfCheck } from "./selfcheck.ts";

const DEFAULTS = {
  max_jobs_per_owner: 10,
  max_jobs_total: 32,
  running_output_bytes: 262144,
  settled_output_bytes: 16384,
};

let settings = { ...DEFAULTS };
let registry: JobRegistry | null = null;
let channel: Channel | null = null;
let ownerWatch: string | null = null;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function requireRegistry(): JobRegistry {
  if (registry === null) throw new CallError(-32603, "jobs registry is not started");
  return registry;
}

export const definition: Definition = {
  provides: ["jobs"],
  requires: [{ capability: "session", optional: true }],
  configKeys: ["max_jobs_per_owner", "max_jobs_total", "running_output_bytes", "settled_output_bytes"],

  setup(wiring) {
    settings = {
      max_jobs_per_owner: positive(wiring.config.max_jobs_per_owner, DEFAULTS.max_jobs_per_owner),
      max_jobs_total: positive(wiring.config.max_jobs_total, DEFAULTS.max_jobs_total),
      running_output_bytes: positive(wiring.config.running_output_bytes, DEFAULTS.running_output_bytes),
      settled_output_bytes: positive(wiring.config.settled_output_bytes, DEFAULTS.settled_output_bytes),
    };
  },

  async start(wiring) {
    channel = wiring.channel;
    registry = new JobRegistry(
      {
        per_owner: settings.max_jobs_per_owner,
        total: settings.max_jobs_total,
        runningBytes: settings.running_output_bytes,
        settledBytes: settings.settled_output_bytes,
      },
      (topic, payload) => {
        void wiring.channel.publish(topic, payload).catch(() => undefined);
      },
      async (producer, producerJobId, reason) => {
        await wiring.channel.call(producer, "job_cancel", { job_id: producerJobId, reason });
      },
    );
    ownerWatch = await wiring.channel.subscribe(["session.deleted"], (_topic, _seq, payload) => {
      const owner = String((payload as { id?: unknown } | null)?.id ?? "");
      if (owner === "") return;
      void requireRegistry().cancelOwner(owner, "owner session deleted");
    });
  },

  methods: {
    register(params) {
      return requireRegistry().register(params);
    },
    append(params) {
      requireRegistry().append(params);
      return {};
    },
    progress(params) {
      requireRegistry().progress(params);
      return {};
    },
    settle(params) {
      return requireRegistry().settle(params);
    },
    list(params) {
      const owner = typeof params?.owner === "string" && params.owner !== "" ? params.owner : undefined;
      return { jobs: requireRegistry().list(owner) };
    },
    get(params) {
      return requireRegistry().get(String(params?.id ?? ""), typeof params?.owner === "string" ? params.owner : undefined);
    },
    read(params) {
      return requireRegistry().read(String(params?.id ?? ""), typeof params?.owner === "string" ? params.owner : undefined);
    },
    wait(params) {
      return requireRegistry().wait(
        String(params?.id ?? ""),
        typeof params?.owner === "string" ? params.owner : undefined,
        Math.min(600_000, positive(params?.timeout_ms, 30_000)),
      );
    },
    kill(params) {
      return requireRegistry().kill(
        String(params?.id ?? ""),
        typeof params?.owner === "string" ? params.owner : undefined,
        typeof params?.reason === "string" ? params.reason : undefined,
      );
    },
  },

  async close() {
    if (channel !== null && ownerWatch !== null) await channel.unsubscribe(ownerWatch).catch(() => undefined);
    ownerWatch = null;
    const current = registry;
    if (current !== null) {
      const ids = current.liveIds();
      await Promise.allSettled(ids.map((id) => current.kill(id, undefined, "kernel shutdown")));
    }
    registry = null;
  },

  selfCheck() {
    return runSelfCheck();
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);