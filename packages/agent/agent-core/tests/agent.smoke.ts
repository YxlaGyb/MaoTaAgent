import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { ToolSpec } from "@maota/agent-loop";

import { systemPrompt } from "../src/prompt.ts";
import { SKILL_TOOL, injectCwd, readToolList } from "../src/tools.ts";

assert.equal(systemPrompt("  base  ", [], null), "base");
assert.equal(systemPrompt("", [], ""), "");
const cwdOnly = systemPrompt("", [], "E:\\proj");
assert.equal(cwdOnly.trim(), "working directory: E:\\proj");
assert.equal(cwdOnly.trimStart().includes(" "), true, "the working directory line should keep its own text");
assert.equal(
  systemPrompt("base", [{ name: "hello", description: "greet the user" }], "E:\\proj"),
  [
    "base",
    "",
    "working directory: E:\\proj",
    "",
    "Skills you can read with the `skill` tool (name: what it is for):",
    "- hello: greet the user",
  ].join("\n"),
);

assert.deepEqual(readToolList(undefined), []);
assert.deepEqual(readToolList({ tools: "nope" }), []);
assert.deepEqual(readToolList({}), []);
assert.deepEqual(readToolList({ tools: [{ name: "shell" }, { name: "" }, "junk", { nope: 1 }] }), [{ name: "shell" }]);
assert.deepEqual(readToolList({ tools: [{ name: "shell", description: "d", capability: "tool.shell" }] }), [
  { name: "shell", description: "d", capability: "tool.shell" },
]);

assert.equal(SKILL_TOOL.name, "skill");
assert.deepEqual(SKILL_TOOL.input_schema, {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
});

const shell: ToolSpec = {
  name: "shell",
  input_schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } } },
};
assert.deepEqual(injectCwd(shell, { command: "ls" }, "E:\\proj"), { command: "ls", cwd: "E:\\proj" });
assert.deepEqual(injectCwd(shell, { command: "ls", cwd: "D:\\x" }, "E:\\proj"), { command: "ls", cwd: "D:\\x" });
assert.deepEqual(injectCwd(shell, { command: "ls" }, null), { command: "ls" });
assert.deepEqual(injectCwd(undefined, { command: "ls" }, "E:\\proj"), { command: "ls" });
const other: ToolSpec = { name: "other", input_schema: { type: "object", properties: { a: { type: "string" } } } };
assert.deepEqual(injectCwd(other, { a: 1 }, "E:\\proj"), { a: 1 });
assert.equal(injectCwd(shell, "ls", "E:\\proj"), "ls");

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
const report = JSON.parse(line) as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  requires?: Array<{ capability: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the agent entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the agent selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "agent.loop", version: "1.1.0" }]);
assert.deepEqual(
  (report.requires ?? []).map((item) => item.capability),
  ["api", "tools", "session", "skill"],
);

console.log("agent ok: systemPrompt, tool specs, cwd injection, the entry --check report");
