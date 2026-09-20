import { spawnSync } from "node:child_process";

import { PROFILE_TEMPLATES, entryOf, rowsOfBundles, repoRoot } from "./index.ts";

interface Report {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
}

const seen = new Map<string, string>();
for (const template of Object.values(PROFILE_TEMPLATES)) {
  for (const row of await rowsOfBundles(template.bundles)) {
    if (!seen.has(row.name)) seen.set(row.name, row.id);
  }
}
const rows = [...seen].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

let failed = 0;
for (const [name, id] of rows) {
  const entry = entryOf(name);
  const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8", cwd: repoRoot });
  const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  let report: Report = {};
  try {
    report = JSON.parse(line) as Report;
  } catch {
  }
  const problems = report.problems ?? [];
  if (run.status !== 0 || problems.length > 0) {
    failed += 1;
    console.log(`FAIL ${id}`);
    for (const problem of problems) console.log(`     ${problem}`);
    if (problems.length === 0) {
      const tail = (run.stderr ?? "").trim().split("\n").slice(-6).join("\n     ");
      console.log(`     exit ${run.status}: ${(tail || line).slice(0, 400)}`);
    }
    continue;
  }
  const provides = (report.provides ?? []).map((item) => `${item.capability}@${item.version}`).join(" ");
  console.log(`ok   ${id.padEnd(26)} ${provides}`);
}
console.log(`${rows.length} plugins checked, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
