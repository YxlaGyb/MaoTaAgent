import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { CallError, packageVersion } from "@maota/plugin-kit";

import {
  DEFAULT_EXPLORE_SYSTEM,
  DEFAULT_GENERAL_SYSTEM,
  PARTIAL,
  SUBAGENT_TYPES,
  TASK_TOOL,
  childId,
  childPlan,
  failureRefusal,
  isSubagentType,
  limitRefusal,
  readSubagentType,
  subagentResult,
  type PlanSettings,
} from "../src/task.ts";

const settings: PlanSettings = {
  explore_tools: ["read", "glob", "grep"],
  child_tools_deny: [],
  general_system: "general prose",
  explore_system: "explore prose",
};

assert.deepEqual([...SUBAGENT_TYPES], ["general", "explore"]);
assert.equal(isSubagentType("general"), true);
assert.equal(isSubagentType("explore"), true);
for (const value of ["deep", "GENERAL", "", 7, null, undefined]) {
  assert.equal(isSubagentType(value), false, `${JSON.stringify(value)} is not a type`);
}
assert.equal(readSubagentType(undefined), "general");
assert.equal(readSubagentType(""), "general");
assert.equal(readSubagentType("explore"), "explore");
assert.throws(() => readSubagentType("deep"), CallError);
assert.throws(() => readSubagentType("deep"), /subagent_type must be one of general, explore/);

const general = childPlan("general", settings);
assert.equal(general.tools_allow, null, "a general subagent gets the whole tool pool");
assert.equal(general.system, "general prose");
const explore = childPlan("explore", settings);
assert.deepEqual(explore.tools_allow, ["read", "glob", "grep"], "an explore subagent gets the reading tools");
assert.deepEqual(explore.tools_deny, [TASK_TOOL], "an explore subagent never gets the delegating tool");
assert.equal(explore.system, "explore prose");

for (const deny of [[], ["pwsh"], [TASK_TOOL], ["task", "task"]]) {
  const plan = childPlan("general", { ...settings, child_tools_deny: deny });
  assert.equal(plan.tools_deny[0], TASK_TOOL, `${JSON.stringify(deny)} should still deny task`);
  assert.equal(
    plan.tools_deny.filter((name) => name === TASK_TOOL).length,
    1,
    `${JSON.stringify(deny)} should deny task exactly once`,
  );
}
assert.deepEqual(
  childPlan("explore", { ...settings, child_tools_deny: ["task", "write"] }).tools_deny,
  ["task", "write"],
  "a deployment's own denials join task rather than replace it",
);
assert.deepEqual(childPlan("general", { ...settings, child_tools_deny: ["pwsh"] }).tools_deny, ["task", "pwsh"]);

const ids = Array.from({ length: 64 }, () => childId());
for (const id of ids) assert.match(id, /^sub-[0-9a-f]{12}$/, `a child id came out as ${id}`);
assert.equal(new Set(ids).size, ids.length, "two children should not share an id");

assert.ok(DEFAULT_GENERAL_SYSTEM.includes("subagent"), "the general prompt should say what it is");
assert.ok(DEFAULT_EXPLORE_SYSTEM.includes("read-only"), "the explore prompt should say what it cannot do");

assert.equal(subagentResult("  the answer  ", "completed"), "the answer");
assert.equal(subagentResult(undefined, "completed"), "(the subagent finished without a final message)");
assert.equal(subagentResult("   ", "completed"), "(the subagent finished without a final message)");
assert.equal(subagentResult("half of it", "max_steps"), `half of it\n\n(${PARTIAL})`);
assert.equal(subagentResult("", "max_steps"), PARTIAL);

assert.ok(limitRefusal(4).includes("4 subagents are already running"));
assert.ok(limitRefusal(4).includes("do not retry"), "the cap should tell the model not to retry");
assert.ok(failureRefusal("explore", "the stream broke").includes("the stream broke"));
assert.ok(failureRefusal("explore", "the stream broke").startsWith("the explore subagent failed"));

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const line = (run.stdout ?? "").trim().split("\n").at(-1) ?? "";
const report = JSON.parse(line) as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the tool entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the tool selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "tool.task", version: packageVersion(import.meta.url) }]);

console.log(
  "tool-subagent ok: the types, the child plans, the child ids, the three result shapes and the entry --check report",
);
