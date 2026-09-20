import assert from "node:assert/strict";

import { parseExitStatus } from "../src/render.ts";

assert.deepEqual(parseExitStatus({ exit_code: 0 }), { ok: true, label: "exit 0" });
assert.deepEqual(parseExitStatus({ exit_code: 1 }), { ok: false, label: "exit 1" });
assert.deepEqual(parseExitStatus({ exit_code: 130 }), { ok: false, label: "exit 130" });
assert.deepEqual(parseExitStatus({ exit_code: null, signal: "SIGTERM" }), {
  ok: false,
  label: "killed by SIGTERM",
});
assert.deepEqual(parseExitStatus({ exit_code: null, signal: null }), { ok: false, label: "no exit status" });
assert.deepEqual(parseExitStatus({ exit_code: 0, timed_out: true }), { ok: false, label: "timed out" });
assert.deepEqual(parseExitStatus({ exit_code: null, signal: "SIGKILL", timed_out: true }), {
  ok: false,
  label: "timed out",
});

console.log("shell ok: exit status rendering");