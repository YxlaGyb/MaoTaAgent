import assert from "node:assert/strict";

import { renderPwshResult } from "../src/result.ts";

const done = renderPwshResult({
  command: "Write-Output hi",
  exit_code: 0,
  signal: null,
  timed_out: false,
  truncated: false,
  stdout: "hi\n",
  stderr: "",
});
assert.deepEqual(done, {
  command: "Write-Output hi",
  status: "exit 0",
  ok: true,
  exit_code: 0,
  timed_out: false,
  truncated: false,
  stdout: "hi\n",
  stderr: "",
});

const failed = renderPwshResult({
  command: "exit 2",
  exit_code: 2,
  signal: null,
  timed_out: false,
  truncated: false,
  stdout: "",
  stderr: "boom\n",
});
assert.equal(failed.ok, false);
assert.equal(failed.status, "exit 2");
assert.equal(failed.stderr, "boom\n");

const cut = renderPwshResult({
  command: "sleep",
  exit_code: null,
  signal: "SIGTERM",
  timed_out: true,
  truncated: true,
  stdout: "x",
  stderr: "",
});
assert.equal(cut.ok, false);
assert.equal(cut.status, "timed out");
assert.equal(cut.truncated, true);
assert.equal(cut.exit_code, null);

console.log("tool-pwsh ok: result rendering");