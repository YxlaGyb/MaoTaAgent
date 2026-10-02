import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Call, Channel } from "@maota/plugin-kit";

import { definition } from "../src/index.ts";
import { SETTINGS_FAILURE } from "../src/store.ts";

const home = mkdtempSync(join(tmpdir(), "maota-settings-smoke-"));
const file = join(home, "settings.json");
const published: Array<[string, unknown]> = [];
const channel = {
  async publish(topic: string, payload: unknown) {
    published.push([topic, payload]);
  },
} as unknown as Channel;
const call = {
  channel,
  config: {},
  capabilities: {},
  capability: "settings",
  method: "get",
  caller: "test",
  signal: new AbortController().signal,
  stream: undefined,
} as unknown as Call;

try {
  definition.setup?.({ channel, config: { file }, capabilities: {} } as never);
  assert.deepEqual(definition.methods.get?.({}, call), { revision: 0, locale: null, theme: null });
  const first = await definition.methods.update?.({ patch: { locale: "zh-CN", theme: "dark" }, expected_revision: 0 }, call);
  assert.deepEqual(first, { revision: 1, locale: "zh-CN", theme: "dark" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { schema_version: 1, revision: 1, locale: "zh-CN", theme: "dark" });
  assert.deepEqual(published[0], ["settings.changed", first]);
  await assert.rejects(
    Promise.resolve(definition.methods.update?.({ patch: { theme: "light" }, expected_revision: 0 }, call)),
    (error: unknown) => (error as { code?: number }).code === SETTINGS_FAILURE.conflict,
  );
  await assert.rejects(Promise.resolve(definition.methods.update?.({ patch: { locale: "bad locale" } }, call)), /locale/);
} finally {
  rmSync(home, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "{}") as { ok?: boolean };
assert.equal(run.status, 0, run.stderr);
assert.equal(report.ok, true);

console.log("settings ok: defaults, updates, conflicts, atomic storage and entry report");
