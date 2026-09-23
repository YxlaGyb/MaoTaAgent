import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { parseFrontmatter, scanSkillRoot } from "@maota/skill";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

const root = mkdtempSync(join(tmpdir(), "skill-filesystem-smoke-"));
try {
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: "utf8" });
  };
  write(join(root, "alpha", "SKILL.md"), "---\ndescription: about alpha\n---\nAlpha body.\n");
  write(join(root, "beta.md"), "---\ndescription: about beta\n---\nBeta body.\n");
  write(join(root, "notes", "readme.txt"), "not a skill\n");
  write(join(root, "SKILL.md"), "---\ndescription: the root manifest\n---\nNot an entry.\n");
  write(join(root, ".hidden", "SKILL.md"), "---\ndescription: hidden\n---\nHidden.\n");

  const scanned = scanSkillRoot({ dir: root, rank: 300, source: "custom" });
  assert.deepEqual(scanned.candidates.map((candidate) => candidate.name), ["alpha", "beta"]);
  assert.deepEqual(scanned.notes, []);
  const alpha = scanned.candidates[0];
  assert.equal(alpha?.rank, 300);
  assert.equal(alpha?.source, "custom");
  assert.equal(alpha?.resourceBase?.path, join(root, "alpha"));
  assert.equal(scanned.candidates[1]?.resourceBase?.path, root);
  assert.equal(parseFrontmatter("---\ndescription: d\n---\nBody.\n").body, "Body.\n");
  assert.deepEqual(scanSkillRoot({ dir: join(root, "missing"), rank: 300, source: "custom" }), {
    candidates: [],
    notes: [],
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
assert.equal(run.status, 0, `the filesystem entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
const report = JSON.parse(((run.stdout ?? "").trim().split("\n").at(-1) ?? "")) as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(report.ok, true, `the filesystem selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["skill.filesystem"]);

console.log("skill-filesystem ok: the root reader, the entry --check report");
