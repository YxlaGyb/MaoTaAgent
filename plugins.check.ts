// 每个插件自检: 声明合法 + selfCheck 过。不起内核、不碰网络。
//   node plugins.check.ts                      # 全部
//   node packages/tools/src/main.ts --check        # 单个
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface Report {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
}

const root = import.meta.dirname;
const names = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const hostOnly = new Set(["boot"]); // 宿主入口，不是插件: 插件都经 plugin-kit 声明

let failed = 0;
let checked = 0;
for (const name of names) {
  const main = join(root, "packages", name, "src", "main.ts");
  if (hostOnly.has(name)) continue;
  if (!existsSync(main)) continue; // 还没写的包（hooks / jobs / mcp / session / ssh ...）先跳过
  checked += 1;

  const run = spawnSync(process.execPath, [main, "--check"], { encoding: "utf8", cwd: root });
  const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
  let report: Report = {};
  try {
    report = JSON.parse(line) as Report;
  } catch {
    // 插件在报告之前就炸了: 下面按运行失败处理
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