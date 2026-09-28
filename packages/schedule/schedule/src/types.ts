export type ScheduleMode = "remind" | "agent" | "script";
export type PermissionMode = "ask" | "auto" | "full";

export interface AfterSpec { kind: "after"; after_seconds: number }
export interface AtSpec { kind: "at"; at: string }
export interface EverySpec { kind: "every"; every_seconds: number }
export interface DailySpec { kind: "daily"; time: string; timezone: string }
export interface WeeklySpec { kind: "weekly"; time: string; timezone: string; weekdays: number[] }
export interface CronSpec { kind: "cron"; expression: string; timezone: string }
export type ScheduleSpec = AfterSpec | AtSpec | EverySpec | DailySpec | WeeklySpec | CronSpec;

export interface ScheduleRecord {
  id: string;
  title: string;
  mode: ScheduleMode;
  spec: ScheduleSpec;
  enabled: boolean;
  anchor_at: string;
  next_at: string | null;
  pending_at?: string;
  created_at: string;
  updated_at: string;
  source_session_id?: string;
  source_cwd?: string;
  prompt?: string;
  workdir?: string;
  thinking?: string;
  max_steps?: number;
  script_path?: string;
  script_args?: string[];
  permission: PermissionMode;
  max_runs?: number;
  not_after?: string;
  run_count: number;
  last_run_at?: string;
  last_status?: string;
}

export interface RunRecord {
  schedule_id: string;
  occurrence: string;
  started_at: string;
  ended_at: string;
  status: "completed" | "failed" | "skipped";
  detail?: string;
  session_id?: string;
  stdout?: string;
  stderr?: string;
}