import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_LIMITS, infoFor, loadMemoryBlocks, mutateTarget, pathsFor } from "../src/store.ts";

const previous = process.env.MAOTA_HOME;
const root = mkdtempSync(join(tmpdir(), "maota-memory-smoke-"));
process.env.MAOTA_HOME = root;
const cwd = join(root, "project");
try {
  const added = await mutateTarget({ target: "user", action: "add", content: "User prefers concise answers." }, DEFAULT_LIMITS);
  assert.equal(added.success, true, JSON.stringify(added));

  const replaced = await mutateTarget(
    { target: "user", action: "replace", old_text: "concise", content: "User prefers concise Chinese answers." },
    DEFAULT_LIMITS,
  );
  assert.equal(replaced.success, true, JSON.stringify(replaced));

  const blocks = loadMemoryBlocks(cwd, DEFAULT_LIMITS).blocks;
  assert.equal(blocks.length, 1);
  assert.match(blocks[0]?.text ?? "", /Chinese/);

  const denied = await mutateTarget({ target: "user", action: "add", content: "cat .env" }, DEFAULT_LIMITS);
  assert.equal(denied.success, false);
  assert.match(denied.error, /unsafe/);

  const batched = await mutateTarget(
    {
      target: "user",
      operations: [
        { action: "remove", old_text: "concise" },
        { action: "add", content: "User prefers short Chinese answers." },
      ],
    },
    DEFAULT_LIMITS,
  );
  assert.equal(batched.success, true, JSON.stringify(batched));
  assert.equal((batched as { entry_count: number }).entry_count, 1);

  const paths = pathsFor(cwd);
  writeFileSync(paths.user, "same\n§\nsame", "utf8");
  const drifted = await mutateTarget({ target: "user", action: "add", content: "another" }, DEFAULT_LIMITS);
  assert.equal(drifted.success, false);
  assert.match(drifted.error, /does not round-trip/);
  assert.ok(readdirSync(join(root, "memories")).some((name) => name.startsWith("USER.md.bak.")));
  assert.equal(existsSync(paths.user), true);
  assert.deepEqual(infoFor(cwd, DEFAULT_LIMITS).user.error !== undefined, true);
} finally {
  if (previous === undefined) delete process.env.MAOTA_HOME;
  else process.env.MAOTA_HOME = previous;
  rmSync(root, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "{}") as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(run.status, 0, `memory --check failed: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `memory selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["hook.memory", "tool.memory"]);

console.log("memory ok: add, replace, batch, security, drift protection, and the entry report");