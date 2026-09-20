import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { ToolSpec } from "@maota/agent-loop";

import { systemPrompt } from "../src/prompt.ts";
import { SKILL_TOOL, injectHostArgs, readToolList, stripHostArgs, type HostValues } from "../src/tools.ts";

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
assert.deepEqual(readToolList({ tools: [{ name: "pwsh" }, { name: "" }, "junk", { nope: 1 }] }), [{ name: "pwsh" }]);
assert.deepEqual(readToolList({ tools: [{ name: "pwsh", description: "d", capability: "tool.pwsh" }] }), [
  { name: "pwsh", description: "d", capability: "tool.pwsh" },
]);

assert.equal(SKILL_TOOL.name, "skill");
assert.deepEqual(SKILL_TOOL.input_schema, {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
});

const host: HostValues = { session_cwd: "E:\\proj" };
const pwsh: ToolSpec = {
  name: "pwsh",
  input_schema: { type: "object", properties: { command: { type: "string" } } },
  host_args: [{ name: "workdir", source: "session_cwd" }],
};
assert.deepEqual(injectHostArgs(pwsh, { command: "ls" }, host), { command: "ls", workdir: "E:\\proj" });
assert.deepEqual(injectHostArgs(pwsh, { command: "ls", workdir: "D:\\x" }, host), {
  command: "ls",
  workdir: "D:\\x",
});
assert.deepEqual(injectHostArgs(pwsh, { command: "ls" }, { session_cwd: null }), { command: "ls" });
assert.deepEqual(injectHostArgs(undefined, { command: "ls" }, host), { command: "ls" });
const read: ToolSpec = {
  name: "read",
  input_schema: { type: "object", properties: { file_path: { type: "string" } } },
};
assert.deepEqual(injectHostArgs(read, { file_path: "a.ts" }, host), { file_path: "a.ts" });
assert.equal(injectHostArgs(pwsh, "ls", host), "ls");

const published = stripHostArgs({
  name: "pwsh",
  description: "run a command",
  input_schema: { type: "object", properties: { command: { type: "string" } } },
  capability: "tool.pwsh",
  host_args: [{ name: "workdir", source: "session_cwd" }],
});
assert.deepEqual(published, {
  name: "pwsh",
  description: "run a command",
  input_schema: { type: "object", properties: { command: { type: "string" } } },
  capability: "tool.pwsh",
});
assert.equal("host_args" in published, false);
assert.deepEqual(stripHostArgs({ name: "bare" }), { name: "bare" });

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

console.log("agent ok: systemPrompt, tool specs, host args, the entry --check report");