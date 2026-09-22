import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { Message, ToolSpec } from "@maota/agent-loop";
import { packageVersion } from "@maota/plugin-kit";

import { catalogNote, lastCatalogEntries, sameCatalog, touchedPaths } from "../src/catalog.ts";
import { approvalText, systemPrompt } from "../src/prompt.ts";
import { hostValue, injectHostArgs, readToolList, stripHostArgs, type HostValues } from "../src/tools.ts";

assert.equal(systemPrompt("  base  ", null), "base");
assert.equal(systemPrompt("", ""), "");
const cwdOnly = systemPrompt("", "E:\\proj");
assert.equal(cwdOnly.trim(), "working directory: E:\\proj");
assert.equal(cwdOnly.trimStart().includes(" "), true, "the working directory line should keep its own text");
assert.equal(systemPrompt("base", "E:\\proj", "ask"), `base\n\nworking directory: E:\\proj\n\n${approvalText("ask")}`);
assert.equal(systemPrompt("base", null, null), "base");
assert.equal(systemPrompt("base", null, "nonsense"), "base");
assert.equal(systemPrompt("base", "E:\\proj").includes("skill"), false, "the prompt should not carry a skill list");
assert.equal(approvalText("ask")?.includes("do not retry"), true);
assert.equal(approvalText("auto")?.includes("without asking"), true);
assert.equal(approvalText("full")?.includes("without asking"), true);
assert.equal(approvalText(undefined), null);

assert.deepEqual(readToolList(undefined), []);
assert.deepEqual(readToolList({ tools: "nope" }), []);
assert.deepEqual(readToolList({}), []);
assert.deepEqual(readToolList({ tools: [{ name: "pwsh" }, { name: "" }, "junk", { nope: 1 }] }), [{ name: "pwsh" }]);
assert.deepEqual(readToolList({ tools: [{ name: "pwsh", description: "d", capability: "tool.pwsh" }] }), [
  { name: "pwsh", description: "d", capability: "tool.pwsh" },
]);

assert.equal(catalogNote(undefined), null);
assert.equal(catalogNote({ kind: "other", entries: [] }), null);
assert.equal(catalogNote({ kind: "skill-catalog" }), null);
assert.equal(catalogNote({ kind: "skill-catalog", entries: [{ name: "s", description: 7 }] }), null);
assert.equal(catalogNote({ kind: "skill-catalog", update: "yes", entries: [] }), null);
assert.deepEqual(catalogNote({ kind: "skill-catalog", entries: [{ name: "s", description: "d" }] }), {
  kind: "skill-catalog",
  update: false,
  entries: [{ name: "s", description: "d" }],
});
const note = (
  entries: Array<{ name: string; description: string }>,
  update = false,
): Message => ({
  role: "user",
  name: "skill-catalog",
  content: "catalog",
  source: { kind: "skill-catalog", ...(update ? { update: true } : {}), entries },
});
assert.equal(lastCatalogEntries([{ role: "user", content: "hi" }]), null);
assert.deepEqual(
  lastCatalogEntries([
    note([{ name: "old", description: "d" }]),
    { role: "assistant", content: "hello" },
    note([{ name: "new", description: "d" }], true),
  ]),
  [{ name: "new", description: "d" }],
);
assert.equal(sameCatalog([{ name: "a", description: "b" }], [{ name: "a", description: "b" }]), true);
assert.equal(sameCatalog([{ name: "a", description: "b" }], [{ name: "a", description: "c" }]), false);
assert.equal(sameCatalog([{ name: "a", description: "b" }], []), false);

const specs = new Map<string, ToolSpec>([
  ["read", { name: "read", paths: ["file_path"] }],
  ["write", { name: "write" }],
]);
const touched: Message[] = [
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "1", function: { name: "read", arguments: '{"file_path":"a.ts"}' } },
      { id: "2", function: { name: "write", arguments: '{"file_path":"b.ts"}' } },
    ],
  },
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "3", function: { name: "read", arguments: '{"file_path":"E:\\\\abs\\\\c.ts"}' } }],
  },
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "4", function: { name: "read", arguments: '{"file_path":["d.ts","e.ts"]}' } }],
  },
];
assert.deepEqual(touchedPaths(touched, specs, "E:\\proj"), [
  "E:\\proj\\a.ts",
  "E:\\abs\\c.ts",
  "E:\\proj\\d.ts",
  "E:\\proj\\e.ts",
]);
assert.deepEqual(touchedPaths(touched, specs, null), ["a.ts", "E:\\abs\\c.ts", "d.ts", "e.ts"]);
assert.equal(touchedPaths(touched, specs, "E:\\proj", 2).length, 2);

const host: HostValues = {
  session_cwd: "E:\\proj",
  session_id: "s1",
  call_id: "c1",
  subagent: null,
  session_touched: [],
};
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
const bare: HostValues = {
  session_cwd: null,
  session_id: null,
  call_id: null,
  subagent: null,
  session_touched: [],
};
assert.deepEqual(injectHostArgs(pwsh, { command: "ls" }, bare), { command: "ls" });
assert.deepEqual(injectHostArgs(undefined, { command: "ls" }, host), { command: "ls" });
const gate: ToolSpec = {
  name: "pwsh",
  input_schema: { type: "object", properties: { command: { type: "string" } } },
  host_args: [
    { name: "workdir", source: "session_cwd" },
    { name: "session_id", source: "session_id" },
    { name: "call_id", source: "call_id" },
  ],
};
assert.deepEqual(injectHostArgs(gate, { command: "ls" }, host), {
  command: "ls",
  workdir: "E:\\proj",
  session_id: "s1",
  call_id: "c1",
});
assert.deepEqual(injectHostArgs(gate, { command: "ls" }, bare), { command: "ls" });
assert.equal(hostValue("session_id", host), "s1");
assert.equal(hostValue("call_id", host), "c1");
assert.equal(hostValue("session_cwd", host), "E:\\proj");
assert.equal(hostValue("elsewhere", host), null);
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
assert.deepEqual(stripHostArgs({ name: "read", paths: ["file_path"] }), { name: "read" });

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
assert.deepEqual(report.provides, [{ capability: "agent.loop", version: packageVersion(import.meta.url) }]);
assert.deepEqual(
  (report.requires ?? []).map((item) => item.capability),
  ["api", "tools", "session", "skill", "permission", "hooks"],
);

console.log("agent ok: systemPrompt, tool specs, host args, the entry --check report");
