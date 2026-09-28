import type { RunRecord, ScheduleRecord } from "@maota/schedule/src/types.ts";

export function renderSchedule(record: ScheduleRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    mode: record.mode,
    enabled: record.enabled,
    schedule: record.spec,
    next_at: record.next_at,
    run_count: record.run_count,
    last_run_at: record.last_run_at,
    last_status: record.last_status,
  };
}

export function renderList(records: ScheduleRecord[]): Record<string, unknown> {
  return { schedules: records.map(renderSchedule) };
}

export function renderRun(run: RunRecord): Record<string, unknown> {
  return {
    schedule_id: run.schedule_id,
    occurrence: run.occurrence,
    status: run.status,
    started_at: run.started_at,
    ended_at: run.ended_at,
    detail: run.detail,
    session_id: run.session_id,
  };
}