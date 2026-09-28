import { nextAfter, parseSpec } from "./clock.ts";
import { cleanText } from "./security.ts";

export function runSelfCheck(): string[] {
  const problems: string[] = [];
  const now = new Date("2099-01-01T00:00:00.000Z");
  const after = parseSpec({ schedule_kind: "after", after_seconds: 60 }, now);
  if (nextAfter(after, now, now)?.toISOString() !== "2099-01-01T00:01:00.000Z") problems.push("after did not advance");
  const every = parseSpec({ schedule_kind: "every", every_seconds: 60 }, now);
  if (nextAfter(every, now, new Date("2099-01-01T00:01:30.000Z"))?.toISOString() !== "2099-01-01T00:02:00.000Z") {
    problems.push("every did not align to its anchor");
  }
  const cron = parseSpec({ schedule_kind: "cron", cron: "0 9 * * *", timezone: "Asia/Shanghai" }, now);
  const next = nextAfter(cron, now, now);
  if (next === null || !next.toISOString().startsWith("2099-01-01T01:00:00")) problems.push("cron did not use its timezone");
  try {
    parseSpec({ schedule_kind: "cron", cron: "0 9 * * L", timezone: "UTC" }, now);
    problems.push("extended cron syntax was accepted");
  } catch {}
  try {
    cleanText("token=secret", "prompt", 100, true);
    problems.push("secret-like content was accepted");
  } catch {}
  return problems;
}