import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nextAfter, parseSpec } from "../src/clock.ts";
import { loadSchedules, saveSchedules } from "../src/store.ts";
import type { ScheduleRecord } from "../src/types.ts";

const now = new Date("2099-01-01T00:00:00.000Z");
const spec = parseSpec({ schedule_kind: "cron", cron: "0 9 * * *", timezone: "Asia/Shanghai" }, now);
assert.equal(nextAfter(spec, now, now)?.toISOString(), "2099-01-01T01:00:00.000Z");

const root = mkdtempSync(join(tmpdir(), "maota-schedule-"));
try {
  const record: ScheduleRecord = {
    id: "sch-1",
    title: "test",
    mode: "agent",
    spec,
    enabled: true,
    anchor_at: now.toISOString(),
    next_at: "2099-01-01T01:00:00.000Z",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    prompt: "test",
    permission: "ask",
    run_count: 0,
  };
  saveSchedules([record], root);
  assert.equal(loadSchedules(root)[0]?.id, "sch-1");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("schedule smoke ok");