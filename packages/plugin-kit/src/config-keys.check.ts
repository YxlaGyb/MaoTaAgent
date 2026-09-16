// plugin-kit 里唯一有点判断的逻辑: 挑出 config 里多出来的键，再给它写一句人话。
//   node packages/plugin-kit/src/config-keys.check.ts
import assert from "node:assert/strict";

import { unknownConfigKeys, unknownConfigWarning } from "./plugin.ts";

// 不声明 configKeys = 整个跳过检查，不是"空集"。
assert.deepEqual(unknownConfigKeys(undefined, { a: 1 }), []);
// 声明空数组 = 一个键都不读，所以剩下的全是多余的。
assert.deepEqual(unknownConfigKeys([], { a: 1 }), ["a"]);
assert.deepEqual(unknownConfigKeys(["a", "b"], { a: 1, b: 2 }), []);
// 顺序照 config 自己的来，多出来的原样保留。
assert.deepEqual(unknownConfigKeys(["a"], { b: 1, a: 2, c: 3 }), ["b", "c"]);

assert.equal(
  unknownConfigWarning("shell", ["timeout_ms", "max_output_bytes", "cwd"], ["timeout_msec"]),
  "unknown config key in plugins.shell.config: timeout_msec (this plugin reads: timeout_ms, max_output_bytes, cwd)",
);
assert.equal(
  unknownConfigWarning("tools", [], ["whatever"]),
  "unknown config key in plugins.tools.config: whatever (this plugin reads no config)",
);
assert.match(unknownConfigWarning("x", [], ["a", "b"]), /^unknown config keys /);

console.log("ok   plugin-kit config-keys");
