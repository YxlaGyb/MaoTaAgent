import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface Report {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
}

const root = join(import.meta.dirname, "..", "..", "..");
const mains = [join(root, "packages"), join(root, "apps")]
  .flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, main: join(dir, entry.name, "src", "main.ts") })),
  )
  .sort((left, right) => left.name.localeCompare(right.name));

const hostOnly = new Set(["boot", "cli"]);

let failed = 0;
let checked = 0;
for (const { name, main } of mains) {
  if (hostOnly.has(name)) continue;
  if (!existsSync(main)) continue;
  checked += 1;

  const run = spawnSync(process.execPath, [main, "--check"], { encoding: "utf8", cwd: root });
  const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  let report: Report = {};
  try {
    report = JSON.parse(line) as Report;
  } catch {
  }
  const problems = report.problems ?? [];
  if (run.status !== 0 || problems.length > 0) {
    failed += 1;
    console.log(`FAIL ${name}`);
    for (const problem of problems) console.log(`     ${problem}`);
    if (problems.length === 0) {
      const tail = (run.stderr ?? "").trim().split("\n").slice(-6).join("\n     ");
      console.log(`     exit ${run.status}: ${(tail || line).slice(0, 400)}`);
    }
    continue;
  }
  const provides = (report.provides ?? []).map((item) => `${item.capability}@${item.version}`).join(" ");
  console.log(`ok   ${name.padEnd(26)} ${provides}`);
}

console.log(`${checked} plugins checked, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
