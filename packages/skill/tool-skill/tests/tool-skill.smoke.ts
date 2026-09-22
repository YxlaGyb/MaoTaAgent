import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { CallError, packageVersion } from "@maota/plugin-kit";

import { definition } from "../src/index.ts";

const described = definition.methods["describe"]?.({}, { capability: "tool.skill" } as never) as {
  name?: string;
  paths?: string[];
  input_schema?: { required?: string[] };
};
assert.equal(described?.name, "skill");
assert.deepEqual(described?.input_schema?.required, ["name"]);
assert.deepEqual(described?.paths, [], "a skill loads by name, not by path");

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
assert.equal(run.status, 0, `the tool entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
const report = JSON.parse(((run.stdout ?? "").trim().split("\n").at(-1) ?? "")) as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(report.ok, true, `the tool selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "tool.skill", version: packageVersion(import.meta.url) }]);
assert.equal(new CallError(-32602, "x").code, -32602);

console.log("tool-skill ok: the described tool, the entry --check report");
