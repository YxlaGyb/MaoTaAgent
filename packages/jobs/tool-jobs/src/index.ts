#!/usr/bin/env node
import {
  CallError,
  defineTools,
  isPluginEntry,
  runPlugin,
  type Call,
  type Channel,
  type Definition,
} from "@maota/plugin-kit";

import type { JobRead, JobView } from "@maota/jobs/src/types.ts";

import { renderJobs, renderRead } from "./render.ts";

let channel: Channel | null = null;
function ownerOf(args: Record<string, unknown>): string {
  const owner = typeof args.session_id === "string" ? args.session_id : "";
  if (owner === "") throw new CallError(-32602, "session_id is required");
  return owner;
}

const toolkit = defineTools([
  {
    capability: "tool.job_output",
    description:
      "Read output from a background job. Reading is non-blocking unless wait is true; wait only when the job blocks " +
      "the next useful step. The final result is returned once. Keep the job id and do not busy-poll.",
    parameters: {
      job_id: { type: "string", required: true, description: "The job id returned when background work started." },
      wait: { type: "boolean", description: "Wait for settlement before reading." },
      timeout_ms: { type: "integer", description: "Maximum wait in milliseconds, capped at 600000." },
      session_id: { type: "string", host: "session_id", description: "Owning session." },
    },
    concurrency: "never",
    maxResultChars: 20_000,
    async run(args, call: Call) {
      const owner = ownerOf(args);
      if (args.wait === true) {
        await call.channel.call(
          "jobs",
          "wait",
          { id: args.job_id, owner, timeout_ms: Math.min(600_000, Number(args.timeout_ms ?? 30_000)) },
          { signal: call.signal, timeout_ms: Math.min(610_000, Number(args.timeout_ms ?? 30_000) + 10_000) },
        );
      }
      const read = (await call.channel.call("jobs", "read", { id: args.job_id, owner }, { signal: call.signal })) as JobRead;
      return renderRead(read);
    },
  },
  {
    capability: "tool.job_list",
    description: "List background jobs owned by this session, with id, kind, status, and label.",
    parameters: {
      session_id: { type: "string", host: "session_id", description: "Owning session." },
    },
    concurrency: "always",
    maxResultChars: 10_000,
    async run(args, call: Call) {
      const reply = (await call.channel.call("jobs", "list", { owner: ownerOf(args) }, { signal: call.signal })) as {
        jobs?: JobView[];
      };
      return renderJobs(reply.jobs ?? []);
    },
  },
  {
    capability: "tool.job_kill",
    description: "Request cancellation of a running background job. The job settles only after its work actually stops.",
    parameters: {
      job_id: { type: "string", required: true, description: "The job to stop." },
      reason: { type: "string", description: "Why the job is no longer needed." },
      session_id: { type: "string", host: "session_id", description: "Owning session." },
    },
    concurrency: "never",
    maxResultChars: 2_000,
    async run(args, call: Call) {
      const reply = (await call.channel.call(
        "jobs",
        "kill",
        { id: args.job_id, owner: ownerOf(args), ...(typeof args.reason === "string" ? { reason: args.reason } : {}) },
        { signal: call.signal },
      )) as { outcome?: string };
      return reply.outcome === "requested"
        ? `requested cancellation of job ${String(args.job_id)}`
        : `job ${String(args.job_id)} had already finished`;
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  hostCalls: [],
  registrations: toolkit.registrations,
  injects: [{ capability: "jobs" }, { capability: "system-prompt", optional: true }],
  configKeys: [],
  async start(wiring) {
    channel = wiring.channel;
    await wiring.channel.call("system-prompt", "register", {
      name: "background-jobs",
      order: 500,
      text: "Track every background job id. Completion arrives in-session; do not busy-poll. Read every still-relevant job with job_output before a final answer, and kill jobs that no longer matter.",
    }).catch(() => undefined);
  },
  async close() {
    await channel?.call("system-prompt", "unregister", { name: "background-jobs" }).catch(() => undefined);
    channel = null;
  },
  methods: { ...toolkit.methods },
  selfCheck() {
    const problems: string[] = [];
    const expected = "tool.job_output,tool.job_list,tool.job_kill";
    if (toolkit.provides.join(",") !== expected) problems.push(`toolkit provides ${toolkit.provides.join(",")}`);
    const call = { capability: "tool.job_output" } as unknown as Call;
    const spec = toolkit.methods.describe({}, call) as { name?: string; input_schema?: { required?: string[] } };
    if (spec.name !== "job_output") problems.push(`job_output is named ${String(spec.name)}`);
    if (spec.input_schema?.required?.join(",") !== "job_id") problems.push("job_output required fields drifted");
    return problems;
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);