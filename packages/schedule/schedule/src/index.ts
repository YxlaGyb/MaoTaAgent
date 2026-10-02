#!/usr/bin/env node
import {
  CallError,
  isPluginEntry,
  runPlugin,
  type Call,
  type Channel,
  type Definition,
} from "@maota/plugin-kit";

import { nextAfter, parseSpec } from "./clock.ts";
import { executeRecord } from "./execution.ts";
import { readRuns, writeRun } from "./history.ts";
import { cleanText } from "./security.ts";
import { loadSchedules, saveSchedules } from "./store.ts";
import { runSelfCheck } from "./selfcheck.ts";
import type { PermissionMode, ScheduleMode, ScheduleRecord } from "./types.ts";

const DEFAULTS = { max_parallel_runs: 2 };
let settings = { ...DEFAULTS };
let records: ScheduleRecord[] = [];
let channel: Channel | null = null;
let timer: NodeJS.Timeout | null = null;
let ticking = false;
const executing = new Set<string>();

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function callLike(): Call {
  return { signal: new AbortController().signal } as Call;
}

function persist(): void {
  saveSchedules(records);
}

function recordOf(id: string): ScheduleRecord {
  const record = records.find((item) => item.id === id);
  if (record === undefined) throw new CallError(-32602, `unknown schedule ${JSON.stringify(id)}`);
  return record;
}

function readPermission(value: unknown): PermissionMode {
  if (value === undefined) return "ask";
  if (value === "ask" || value === "auto" || value === "full") return value;
  throw new CallError(-32602, "permission must be ask, auto, or full");
}

function optionalPositive(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CallError(-32602, `${field} must be a positive integer`);
  }
  return value;
}

function applyCommon(record: ScheduleRecord, params: Record<string, unknown>, partial = false): ScheduleRecord {
  const mode = params.mode ?? (partial ? record.mode : undefined);
  if (mode !== "remind" && mode !== "agent" && mode !== "script") {
    throw new CallError(-32602, "mode must be remind, agent, or script");
  }
  const permission = params.permission === undefined
    ? (partial ? record.permission : readPermission(undefined))
    : readPermission(params.permission);
  const next: ScheduleRecord = { ...record, mode: mode as ScheduleMode, permission };
  const title = cleanText(params.title, "title", 120, !partial);
  if (title !== undefined) next.title = title;

  const promptRequired = mode !== "script" && (!partial || params.mode !== undefined || next.prompt === undefined);
  if (params.prompt !== undefined || !partial) {
    const prompt = cleanText(params.prompt, "prompt", 20_000, promptRequired);
    if (prompt === undefined) delete next.prompt;
    else next.prompt = prompt;
  }

  if (params.workdir !== undefined || !partial) {
    const workdir = cleanText(params.workdir, "workdir", 1000);
    if (workdir === undefined) delete next.workdir;
    else next.workdir = workdir;
  }
  if (params.thinking !== undefined || !partial) {
    const thinking = cleanText(params.thinking, "thinking", 32);
    if (thinking === undefined) delete next.thinking;
    else next.thinking = thinking;
  }
  if (params.max_steps !== undefined || !partial) {
    const maxSteps = optionalPositive(params.max_steps, "max_steps");
    if (maxSteps === undefined) delete next.max_steps;
    else next.max_steps = maxSteps;
  }
  if (params.max_runs !== undefined || !partial) {
    const maxRuns = optionalPositive(params.max_runs, "max_runs");
    if (maxRuns === undefined) delete next.max_runs;
    else next.max_runs = maxRuns;
  }
  if (params.not_after !== undefined || !partial) {
    if (params.not_after === undefined) delete next.not_after;
    else {
      const at = cleanText(params.not_after, "not_after", 100, true)!;
      if (!Number.isFinite(Date.parse(at))) throw new CallError(-32602, "not_after must be an RFC3339 timestamp");
      next.not_after = at;
    }
  }
  if (params.source_session_id !== undefined || !partial) {
    const source = cleanText(params.source_session_id, "source_session_id", 64);
    if (source === undefined) delete next.source_session_id;
    else next.source_session_id = source;
  }
  if (params.source_cwd !== undefined || !partial) {
    const sourceCwd = cleanText(params.source_cwd, "source_cwd", 1000);
    if (sourceCwd === undefined) delete next.source_cwd;
    else next.source_cwd = sourceCwd;
  }

  const scriptRequired = mode === "script" && (!partial || params.mode !== undefined || next.script_path === undefined);
  if (params.script_path !== undefined || scriptRequired || !partial) {
    if (mode !== "script") {
      delete next.script_path;
      delete next.script_args;
    } else {
      const path = cleanText(params.script_path, "script_path", 1000, scriptRequired)!;
      if (path.includes("..") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\")) {
        throw new CallError(-32602, "script_path must stay inside the scripts directory");
      }
      next.script_path = path;
    }
  }
  if (mode === "script" && (params.script_args !== undefined || !partial)) {
    if (params.script_args !== undefined && (!Array.isArray(params.script_args) || !params.script_args.every((item) => typeof item === "string"))) {
      throw new CallError(-32602, "script_args must be a string array");
    }
    next.script_args = Array.isArray(params.script_args) ? [...params.script_args] : [];
  }
  if (mode === "remind" && (next.source_session_id === undefined || next.source_cwd === undefined)) {
    throw new CallError(-32602, "remind schedules require source_session_id and source_cwd");
  }
  return next;
}

function scheduleOf(specSource: Record<string, unknown>, anchor: Date): ScheduleRecord["spec"] {
  return parseSpec(specSource, anchor);
}

function createRecord(params: unknown): ScheduleRecord {
  if (params === null || typeof params !== "object" || Array.isArray(params)) throw new CallError(-32602, "schedule parameters are required");
  const raw = params as Record<string, unknown>;
  const now = new Date();
  const anchor = now.toISOString();
  const spec = scheduleOf(raw, now);
  const next = nextAfter(spec, now, now);
  if (next === null) throw new CallError(-32602, "schedule has no future occurrence");
  const record = applyCommon(
    {
      id: `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: "",
      mode: "remind",
      spec,
      enabled: raw.enabled !== false,
      anchor_at: anchor,
      next_at: next.toISOString(),
      created_at: anchor,
      updated_at: anchor,
      permission: "ask",
      run_count: 0,
    },
    raw,
    false,
  );
  return record;
}

async function runRecord(record: ScheduleRecord, occurrence: string): Promise<void> {
  if (channel === null) return;
  executing.add(record.id);
  const call = callLike();
  try {
    const result = await executeRecord(record, occurrence, channel, call);
    writeRun(result);
    record.last_run_at = new Date().toISOString();
    record.last_status = result.status;
  } catch (error) {
    writeRun({
      schedule_id: record.id,
      occurrence,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    record.last_run_at = new Date().toISOString();
    record.last_status = "failed";
  } finally {
    executing.delete(record.id);
    persist();
    void tick();
  }
}

async function startDue(record: ScheduleRecord): Promise<void> {
  const occurrence = record.pending_at ?? record.next_at;
  if (occurrence === null) return;
  const now = new Date();
  record.pending_at = occurrence;
  record.run_count += 1;
  const anchor = new Date(record.anchor_at);
  const next = nextAfter(record.spec, anchor, now);
  const maxed = record.max_runs !== undefined && record.run_count >= record.max_runs;
  const expired = record.not_after !== undefined && Date.parse(record.not_after) <= now.getTime();
  record.next_at = next?.toISOString() ?? null;
  if (maxed || expired || next === null) record.enabled = false;
  persist();
  await runRecord(record, occurrence);
  delete record.pending_at;
  persist();
}

async function tick(): Promise<void> {
  if (ticking || channel === null) return;
  ticking = true;
  try {
    const now = Date.now();
    const due = records.filter((record) =>
      record.enabled && (record.pending_at !== undefined || (record.next_at !== null && Date.parse(record.next_at) <= now)),
    );
    for (const record of due) {
      if (executing.size >= settings.max_parallel_runs) break;
      if (executing.has(record.id)) continue;
      void startDue(record);
    }
  } finally {
    ticking = false;
  }
}

function refreshNext(record: ScheduleRecord, now: Date): void {
  const next = nextAfter(record.spec, new Date(record.anchor_at), now);
  record.next_at = next?.toISOString() ?? null;
  if (next === null) record.enabled = false;
}

export const definition: Definition = {
  provides: ["schedule"],
  hostCalls: ["schedule"],
  registrations: [],
  injects: [
    { capability: "agent.runner" },
    { capability: "shell" },
    { capability: "permission", optional: true },
  ],
  configKeys: ["max_parallel_runs"],

  setup(wiring) {
    settings = { max_parallel_runs: positive(wiring.config.max_parallel_runs, DEFAULTS.max_parallel_runs) };
  },

  start(wiring) {
    channel = wiring.channel;
    records = loadSchedules();
    const now = new Date();
    for (const record of records) {
      const next = record.next_at === null ? null : new Date(record.next_at);
      if (next === null || !Number.isFinite(next.getTime())) refreshNext(record, now);
    }
    persist();
    timer = setInterval(() => void tick(), 1000);
    void tick();
  },

  methods: {
    create(params) {
      const record = createRecord(params);
      records.push(record);
      persist();
      return record;
    },
    list() {
      return { schedules: records };
    },
    update(params) {
      const raw = (params ?? {}) as Record<string, unknown>;
      const record = recordOf(String(raw.id ?? ""));
      const specChanged = raw.schedule_kind !== undefined || raw.kind !== undefined;
      if (specChanged) {
        const now = new Date();
        record.spec = scheduleOf(raw, now);
        record.anchor_at = now.toISOString();
        refreshNext(record, now);
      }
      applyCommon(record, raw, true);
      if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== "boolean") throw new CallError(-32602, "enabled must be boolean");
        record.enabled = raw.enabled;
      }
      if (record.enabled && record.next_at === null && record.pending_at === undefined) refreshNext(record, new Date());
      record.updated_at = new Date().toISOString();
      persist();
      return record;
    },
    delete(params) {
      const id = String((params as { id?: unknown } | null)?.id ?? "");
      const before = records.length;
      records = records.filter((record) => record.id !== id);
      if (records.length === before) throw new CallError(-32602, `unknown schedule ${JSON.stringify(id)}`);
      persist();
      return { id, deleted: true };
    },
    async run_now(params) {
      const record = recordOf(String((params as { id?: unknown } | null)?.id ?? ""));
      const occurrence = new Date().toISOString();
      const call = callLike();
      const result = await executeRecord(record, occurrence, channel!, call);
      writeRun(result);
      return result;
    },
    history(params) {
      const id = String((params as { id?: unknown } | null)?.id ?? "");
      recordOf(id);
      return { runs: readRuns(id, Number((params as { limit?: unknown } | null)?.limit ?? 50)) };
    },
  },

  async close() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    channel = null;
    persist();
  },

  async selfCheck() {
    return await runSelfCheck();
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);