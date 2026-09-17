import assert from "node:assert/strict";

import { unknownConfigKeys, unknownConfigWarning } from "./plugin.ts";

assert.deepEqual(unknownConfigKeys(undefined, { a: 1 }), []);
assert.deepEqual(unknownConfigKeys([], { a: 1 }), ["a"]);
assert.deepEqual(unknownConfigKeys(["a", "b"], { a: 1, b: 2 }), []);
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
