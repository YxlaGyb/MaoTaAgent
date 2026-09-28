import { CallError } from "@maota/plugin-kit";

import { cleanText } from "./security.ts";
import type { CronSpec, DailySpec, ScheduleSpec, WeeklySpec } from "./types.ts";

interface LocalParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  year: number;
  weekday: number;
}

const DAY = 86_400_000;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CallError(-32602, `${field} must be a positive integer`);
  }
  return value;
}

export function timezoneOf(value: unknown): string {
  const timezone = cleanText(value, "timezone", 100, true)!;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new CallError(-32602, `unknown timezone ${JSON.stringify(timezone)}`);
  }
  return timezone;
}

function timeOf(value: unknown): string {
  const time = cleanText(value, "time", 20, true)!;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (match === null) throw new CallError(-32602, "time must use HH:mm or HH:mm:ss");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) throw new CallError(-32602, "time is outside the clock range");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function weekdaysOf(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new CallError(-32602, "weekdays must be a non-empty array");
  const days: number[] = [];
  for (const item of value) {
    if (!Number.isInteger(item) || (item as number) < 1 || (item as number) > 7) {
      throw new CallError(-32602, "weekdays use ISO values 1 through 7");
    }
    const day = (item as number) % 7;
    if (!days.includes(day)) days.push(day);
  }
  return days.sort((left, right) => left - right);
}

interface CronField {
  raw: string;
  values: Set<number>;
  any: boolean;
}

function cronField(raw: string, min: number, max: number, field: string): CronField {
  if (raw.trim() === "") throw new CallError(-32602, `${field} is empty`);
  if (/[LW#?A-Za-z]/.test(raw)) throw new CallError(-32602, `${field} uses unsupported cron syntax`);
  const values = new Set<number>();
  let any = false;
  for (const part of raw.split(",")) {
    let step = 1;
    let body = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      body = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) throw new CallError(-32602, `${field} has an invalid step`);
    }
    let start: number;
    let end: number;
    if (body === "*") {
      start = min;
      end = max;
      if (slash < 0) any = true;
    } else if (body.includes("-")) {
      const halves = body.split("-");
      if (halves.length !== 2) throw new CallError(-32602, `${field} has an invalid range`);
      start = Number(halves[0]);
      end = Number(halves[1]);
    } else {
      start = Number(body);
      end = slash >= 0 ? max : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new CallError(-32602, `${field} is outside ${min}-${max}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { raw, values, any };
}

export function cronFields(expression: string): { minute: CronField; hour: CronField; day: CronField; month: CronField; weekday: CronField } {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new CallError(-32602, "cron must have five fields");
  const weekday = cronField(fields[4]!, 0, 7, "weekday");
  if (weekday.values.has(7)) {
    weekday.values.delete(7);
    weekday.values.add(0);
  }
  return {
    minute: cronField(fields[0]!, 0, 59, "minute"),
    hour: cronField(fields[1]!, 0, 23, "hour"),
    day: cronField(fields[2]!, 1, 31, "day-of-month"),
    month: cronField(fields[3]!, 1, 12, "month"),
    weekday,
  };
}

export function parseSpec(value: unknown, _anchor: Date): ScheduleSpec {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CallError(-32602, "schedule is required");
  const raw = value as Record<string, unknown>;
  const kind = raw.schedule_kind ?? raw.kind;
  if (kind === "after") return { kind, after_seconds: positiveInt(raw.after_seconds, "after_seconds") };
  if (kind === "every") return { kind, every_seconds: positiveInt(raw.every_seconds, "every_seconds") };
  if (kind === "at") {
    const at = cleanText(raw.at, "at", 100, true)!;
    const time = Date.parse(at);
    if (!Number.isFinite(time)) throw new CallError(-32602, "at must be an RFC3339 timestamp");
    return { kind, at };
  }
  if (kind === "daily") return { kind, time: timeOf(raw.time), timezone: timezoneOf(raw.timezone) };
  if (kind === "weekly") {
    return { kind, time: timeOf(raw.time), timezone: timezoneOf(raw.timezone), weekdays: weekdaysOf(raw.weekdays) };
  }
  if (kind === "cron") {
    const expression = cleanText(raw.cron ?? raw.expression, "cron", 200, true)!;
    const fields = cronFields(expression);
    const normalized = [fields.minute.raw, fields.hour.raw, fields.day.raw, fields.month.raw, fields.weekday.raw].join(" ");
    return { kind, expression: normalized, timezone: timezoneOf(raw.timezone) };
  }
  throw new CallError(-32602, "schedule_kind must be after, at, every, daily, weekly, or cron");
}

function local(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    minute: Number(pick("minute")),
    hour: Number(pick("hour")),
    day: Number(pick("day")),
    month: Number(pick("month")),
    year: Number(pick("year")),
    weekday: WEEKDAYS[pick("weekday")] ?? 0,
  };
}

function atMinute(time: string): { hour: number; minute: number } {
  return { hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) };
}

function scan(spec: DailySpec | WeeklySpec | CronSpec, after: Date): Date | null {
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const limit = start + 366 * DAY;
  const daily = spec.kind === "daily" || spec.kind === "weekly" ? atMinute(spec.time) : null;
  const cron = spec.kind === "cron" ? cronFields(spec.expression) : null;
  const days = spec.kind === "weekly" ? new Set(spec.weekdays) : null;
  for (let time = start; time <= limit; time += 60_000) {
    const date = new Date(time);
    const value = local(date, spec.timezone);
    if (value.minute !== 0 && cron === null) {
      if (value.minute !== (daily?.minute ?? -1)) continue;
    }
    if (daily !== null && (value.hour !== daily.hour || value.minute !== daily.minute)) continue;
    if (days !== null && !days.has(value.weekday)) continue;
    if (cron !== null) {
      const dayMatch = cron.day.values.has(value.day);
      const weekMatch = cron.weekday.values.has(value.weekday);
      const domAny = cron.day.any;
      const dowAny = cron.weekday.any;
      if (!cron.minute.values.has(value.minute) || !cron.hour.values.has(value.hour) || !cron.month.values.has(value.month)) continue;
      const dayOk = domAny && dowAny ? true : domAny ? weekMatch : dowAny ? dayMatch : dayMatch || weekMatch;
      if (!dayOk) continue;
    }
    return date;
  }
  return null;
}

export function nextAfter(spec: ScheduleSpec, anchor: Date, after: Date): Date | null {
  if (spec.kind === "after") {
    const at = anchor.getTime() + spec.after_seconds * 1000;
    return at > after.getTime() ? new Date(at) : null;
  }
  if (spec.kind === "at") {
    const at = Date.parse(spec.at);
    return at > after.getTime() ? new Date(at) : null;
  }
  if (spec.kind === "every") {
    const step = spec.every_seconds * 1000;
    const elapsed = Math.max(0, after.getTime() - anchor.getTime());
    const count = Math.floor(elapsed / step) + 1;
    return new Date(anchor.getTime() + count * step);
  }
  return scan(spec, after);
}