import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scanSkillRoot } from "@maota/skill";

const here = dirname(fileURLToPath(import.meta.url));
const scanned = scanSkillRoot({ dir: join(here, "..", "skills"), rank: 600, source: "bundled" });
assert.deepEqual(scanned.notes, [], `the bundled skills logged ${JSON.stringify(scanned.notes)}`);
assert.deepEqual(
  scanned.candidates.map((candidate) => candidate.name),
  ["code-review", "commit-and-pr", "debug-repro", "doc-pairs", "plugin-authoring", "skill-authoring"],
);
for (const candidate of scanned.candidates) {
  assert.ok(candidate.description.length > 40, `${candidate.name} needs a trigger line, not a label`);
}
const projectSpecific = scanned.candidates.filter((candidate) => candidate.description.startsWith("MaoTa project only:"));
assert.deepEqual(
  projectSpecific.map((candidate) => candidate.name),
  ["doc-pairs", "plugin-authoring", "skill-authoring"],
  "the skills that describe this repository must say so",
);
assert.deepEqual(scanned.candidates.find((c) => c.name === "plugin-authoring")?.paths, ["packages/**"]);

const entry = join(here, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
assert.equal(run.status, 0, `the bundled entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
const report = JSON.parse(((run.stdout ?? "").trim().split("\n").at(-1) ?? "")) as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(report.ok, true, `the bundled selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["skill.bundled"]);

console.log("skill-bundled ok: six shipped skills, the entry --check report");
