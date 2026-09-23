import { spawnSync } from "node:child_process";

import { PROFILE_TEMPLATES, entryOf, rowsOfBundles, repoRoot } from "./index.ts";

interface Require {
  capability: string;
  optional?: boolean;
}

interface Report {
  provides?: string[];
  requires?: Require[];
  problems?: string[];
}

const seen = new Map<string, string>();
for (const template of Object.values(PROFILE_TEMPLATES)) {
  for (const row of await rowsOfBundles(template.bundles)) {
    if (!seen.has(row.name)) seen.set(row.name, row.id);
  }
}
const rows = [...seen].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

const checked = rows.map(([name, id]) => {
  const run = spawnSync(process.execPath, [entryOf(name), "--check"], { encoding: "utf8", cwd: repoRoot });
  const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  let report: Report = {};
  try {
    report = JSON.parse(line) as Report;
  } catch {
  }
  const tail = (run.stderr ?? "").trim().split("\n").slice(-6).join("\n     ");
  return { id, report, status: run.status, detail: (tail || line).slice(0, 400) };
});

/// A plugin's own report cannot see the rest of the set, so the one thing none
/// of them can check alone is checked here: a require nothing answers.
const offered = new Set<string>();
for (const { report } of checked) {
  for (const capability of report.provides ?? []) offered.add(capability);
}

let failed = 0;
for (const { id, report, status, detail } of checked) {
  const problems = [...(report.problems ?? [])];
  for (const item of report.requires ?? []) {
    if (item.optional !== true && !offered.has(item.capability)) {
      problems.push(`requires \`${item.capability}\`, which no plugin in this set provides`);
    }
  }
  if (status !== 0 || problems.length > 0) {
    failed += 1;
    console.log(`FAIL ${id}`);
    for (const problem of problems) console.log(`     ${problem}`);
    if (problems.length === 0) console.log(`     exit ${status}: ${detail}`);
    continue;
  }
  console.log(`ok   ${id.padEnd(26)} ${(report.provides ?? []).join(" ")}`);
}
console.log(`${checked.length} plugins checked, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
