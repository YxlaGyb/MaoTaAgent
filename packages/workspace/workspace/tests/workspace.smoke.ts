import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Call, Channel } from "@maota/plugin-kit";

import { definition } from "../src/index.ts";
import { WORKSPACE_FAILURE } from "../src/store.ts";

const home = mkdtempSync(join(tmpdir(), "maota-workspace-smoke-"));
const file = join(home, "workspaces.json");
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
  capability: "workspace",
  method: "get",
  caller: "test",
  signal: new AbortController().signal,
  stream: undefined,
} as unknown as Call;

try {
  definition.setup?.({ channel, config: { file }, capabilities: {} } as never);
  assert.deepEqual(definition.methods.get?.({}, call), { revision: 0, projects: [], pinned_sessions: [], archived_sessions: [] });
  const registered = await definition.methods.register?.({ path: "E:\\proj", name: "Project", expected_revision: 0 }, call);
  assert.equal((registered as { revision: number }).revision, 1);
  const pinned = await definition.methods.set_pin?.({ session_id: "s1", pinned: true, expected_revision: 1 }, call);
  assert.deepEqual((pinned as { pinned_sessions: string[] }).pinned_sessions, ["s1"]);
  const archived = await definition.methods.set_archive?.({ session_id: "s1", archived: true, expected_revision: 2 }, call);
  assert.deepEqual((archived as { pinned_sessions: string[] }).pinned_sessions, []);
  assert.deepEqual((archived as { archived_sessions: string[] }).archived_sessions, ["s1"]);
  const restored = await definition.methods.set_archive?.({ session_id: "s1", archived: false, expected_revision: 3 }, call);
  assert.deepEqual((restored as { pinned_sessions: string[] }).pinned_sessions, []);
  const removed = await definition.methods.remove?.({ path: "E:\\proj", expected_revision: 4 }, call);
  assert.deepEqual((removed as { projects: unknown[] }).projects, []);
  const readded = await definition.methods.register?.({ path: "E:\\proj", expected_revision: 5 }, call);
  assert.equal((readded as { projects: Array<{ path: string }> }).projects[0]?.path, "E:\\proj");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).schema_version, 1);
  assert.deepEqual(published.at(-1)?.[0], "workspace.changed");
  await assert.rejects(
    Promise.resolve(definition.methods.remove?.({ path: "E:\\proj", expected_revision: 0 }, call)),
    (error: unknown) => (error as { code?: number }).code === WORKSPACE_FAILURE.conflict,
  );
} finally {
  rmSync(home, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "{}") as { ok?: boolean };
assert.equal(run.status, 0, run.stderr);
assert.equal(report.ok, true);

console.log("workspace ok: registration, pin/archive exclusivity, removal, restoration and entry report");
