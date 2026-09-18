import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseArgs } from "../src/args.ts";

const main = join(import.meta.dirname, "..", "src", "main.ts");
const VERSION = (
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string }
).version;

const cases: Array<[string[], unknown]> = [
  [[], { kind: "repl", config: undefined, kernel: undefined, session: "cli" }],
  [["what is 2+2"], { kind: "once", question: "what is 2+2", config: undefined, kernel: undefined, session: "cli" }],
  [["fix", "the", "bug"], { kind: "once", question: "fix the bug", config: undefined, kernel: undefined, session: "cli" }],
  [["serve"], { kind: "serve", config: undefined, kernel: undefined, session: "cli" }],
  [["--session", "web", "serve"], { kind: "serve", config: undefined, kernel: undefined, session: "web" }],
  [["check"], { kind: "check", json: false, config: undefined, kernel: undefined, session: "cli" }],
  [["check", "--json"], { kind: "check", json: true, config: undefined, kernel: undefined, session: "cli" }],
  [["--config", "a.toml", "--kernel", "k.exe", "check"], { kind: "check", json: false, config: "a.toml", kernel: "k.exe", session: "cli" }],
  [["--help"], { kind: "help" }],
  [["-h"], { kind: "help" }],
  [["--version"], { kind: "version" }],
  [["-v"], { kind: "version" }],
  [["--help", "serve"], { kind: "help" }],
  [["--nope"], { kind: "usage", message: "unknown option: --nope" }],
  [["--config"], { kind: "usage", message: "option --config needs a value" }],
  [["serve", "extra"], { kind: "usage", message: "serve takes no further arguments: extra" }],
  [["check", "now"], { kind: "usage", message: "check takes no further arguments: now" }],
];

for (const [argv, want] of cases) {
  assert.deepEqual(parseArgs(argv), want, `parseArgs(${JSON.stringify(argv)})`);
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`拉不起来 ${process.execPath}（${args.join(" ")}）: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const help = run(["--help"]);
assert.equal(help.status, 0, help.stderr);
assert.ok(help.stdout.includes("maota check"), "help 要列出 check 子命令");
assert.ok(help.stdout.includes("退出码:"), "help 要列出退出码表");

const version = run(["--version"]);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout, `maota ${VERSION}\n`);

const unknown = run(["--nope"]);
assert.equal(unknown.status, 2, `未知选项的退出码是 2，实际 ${unknown.status}`);
assert.ok(unknown.stderr.includes("unknown option: --nope"), unknown.stderr);

const misplaced = run(["serve", "extra"]);
assert.equal(misplaced.status, 2, `serve 带位置参数的退出码是 2，实际 ${misplaced.status}`);

console.log(`cli ok: ${cases.length} 条语法用例 / --help / --version / 用法错误退出码 2`);
