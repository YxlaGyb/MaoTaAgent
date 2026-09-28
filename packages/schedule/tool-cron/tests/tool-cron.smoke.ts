import assert from "node:assert/strict";

import { definition } from "../src/index.ts";

const problems = (await definition.selfCheck?.()) ?? [];
assert.deepEqual(problems, []);
assert.equal(definition.provides.length, 5);
console.log("tool-cron smoke ok");