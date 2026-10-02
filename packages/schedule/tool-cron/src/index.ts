#!/usr/bin/env node
import {
  defineTools,
  isPluginEntry,
  runPlugin,
  type Call,
  type Definition,
  type ParameterField,
} from "@maota/plugin-kit";
import type { RunRecord, ScheduleRecord } from "@maota/schedule/src/types.ts";

import { renderList, renderRun, renderSchedule } from "./render.ts";

const scheduleParameters: Record<string, ParameterField> = {
  schedule_kind: {
    type: "string",
    enum: ["after", "at", "every", "daily", "weekly", "cron"],
    required: true,
    description: "How the next occurrence is computed.",
  },
  after_seconds: { type: "integer", description: "Positive delay for after." },
  at: { type: "string", description: "RFC3339 absolute timestamp for at." },
  every_seconds: { type: "integer", description: "Fixed interval in seconds." },
  time: { type: "string", description: "Local HH:mm or HH:mm:ss for daily or weekly." },
  timezone: { type: "string", description: "IANA timezone for daily, weekly, or cron." },
  weekdays: { type: "array", items: { type: "integer" }, description: "ISO weekdays 1 through 7 for weekly." },
  cron: { type: "string", description: "Five-field Vixie cron expression." },
} as const;

const commonParameters: Record<string, ParameterField> = {
  title: { type: "string", required: true, description: "Short task name." },
  mode: { type: "string", enum: ["remind", "agent", "script"], required: true, description: "What fires." },
  prompt: { type: "string", description: "Reminder or self-contained agent prompt." },
  workdir: { type: "string", description: "Working directory for agent or script mode." },
  thinking: { type: "string", description: "Thinking level for agent mode." },
  max_steps: { type: "integer", description: "Maximum model steps for agent mode." },
  script_path: { type: "string", description: "Script path relative to the scripts directory." },
  script_args: { type: "array", items: { type: "string" }, description: "Arguments passed without shell interpolation." },
  permission: { type: "string", enum: ["ask", "auto", "full"], description: "Permission policy for agent or script mode." },
  max_runs: { type: "integer", description: "Optional total run limit." },
  not_after: { type: "string", description: "Optional RFC3339 end time." },
  enabled: { type: "boolean", description: "Whether the task is armed." },
  source_session_id: { type: "string", host: "session_id", description: "Session receiving reminders or results." },
  source_cwd: { type: "string", host: "session_cwd", description: "Source session working directory." },
} as const;

function optionalParameters(parameters: Record<string, ParameterField>): Record<string, ParameterField> {
  return Object.fromEntries(Object.entries(parameters).map(([name, field]) => [name, { ...field, required: false }]));
}
const toolkit = defineTools([
  {
    capability: "tool.cron_create",
    description:
      "Create a persistent scheduled task. Use remind to send a reminder into this session, agent to run a self-contained prompt in a fresh session, or script to run a controlled script without a model.",
    parameters: { ...scheduleParameters, ...commonParameters },
    concurrency: "never",
    maxResultChars: 8_000,
    async run(args, call: Call) {
      const record = (await call.channel.call("schedule", "create", args, { signal: call.signal })) as ScheduleRecord;
      return renderSchedule(record);
    },
  },
  {
    capability: "tool.cron_list",
    description: "List persistent scheduled tasks, their next occurrence, run count, and status.",
    parameters: {},
    concurrency: "always",
    maxResultChars: 20_000,
    async run(_args, call: Call) {
      const reply = (await call.channel.call("schedule", "list", {}, { signal: call.signal })) as { schedules?: ScheduleRecord[] };
      return renderList(reply.schedules ?? []);
    },
  },
  {
    capability: "tool.cron_update",
    description: "Update a scheduled task in place. Omitted fields keep their stored values.",
    parameters: {
      id: { type: "string", required: true, description: "Schedule id." },
      ...optionalParameters(scheduleParameters),
      ...optionalParameters(commonParameters),
    },
    concurrency: "never",
    maxResultChars: 8_000,
    async run(args, call: Call) {
      const record = (await call.channel.call("schedule", "update", args, { signal: call.signal })) as ScheduleRecord;
      return renderSchedule(record);
    },
  },
  {
    capability: "tool.cron_delete",
    description: "Delete a scheduled task by id.",
    parameters: { id: { type: "string", required: true, description: "Schedule id." } },
    concurrency: "never",
    maxResultChars: 2_000,
    async run(args, call: Call) {
      return await call.channel.call("schedule", "delete", { id: args.id }, { signal: call.signal });
    },
  },
  {
    capability: "tool.cron_run_now",
    description: "Run a scheduled task immediately without changing its next occurrence.",
    parameters: { id: { type: "string", required: true, description: "Schedule id." } },
    concurrency: "never",
    maxResultChars: 20_000,
    async run(args, call: Call) {
      const run = (await call.channel.call("schedule", "run_now", { id: args.id }, { signal: call.signal, timeout_ms: 3_610_000 })) as RunRecord;
      return renderRun(run);
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  hostCalls: [],
  registrations: toolkit.registrations,
  injects: [{ capability: "schedule" }],
  configKeys: [],
  methods: { ...toolkit.methods },
  selfCheck() {
    const problems: string[] = [];
    const expected = "tool.cron_create,tool.cron_list,tool.cron_update,tool.cron_delete,tool.cron_run_now";
    if (toolkit.provides.join(",") !== expected) problems.push(`toolkit provides ${toolkit.provides.join(",")}`);
    if (toolkit.provides.some((name) => !name.startsWith("tool.cron_"))) problems.push("cron tool prefix drifted");
    return problems;
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);
