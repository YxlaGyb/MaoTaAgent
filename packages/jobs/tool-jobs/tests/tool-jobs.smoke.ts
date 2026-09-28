import assert from "node:assert/strict";

import { definition } from "../src/index.ts";

const problems = (await definition.selfCheck?.()) ?? [];
assert.deepEqual(problems, []);
assert.equal(definition.provides.join(","), "tool.job_output,tool.job_list,tool.job_kill");
console.log("tool-jobs smoke ok");