import assert from "node:assert/strict";

import { runPwsh } from "../src/pwsh.ts";

const BASE = { max_output_bytes: 64 * 1024, cwd: undefined };

const echoed = await runPwsh({
  ...BASE,
  command: "Write-Output maota",
  timeout_ms: 20_000,
  signal: new AbortController().signal,
});
assert.equal(echoed.exit_code, 0);
assert.equal(echoed.timed_out, false);
assert.equal(echoed.truncated, false);
assert.equal(echoed.command, "Write-Output maota");
assert.match(echoed.stdout, /maota/);

const wide = await runPwsh({
  ...BASE,
  command: "Write-Output '中文 ok'",
  timeout_ms: 20_000,
  signal: new AbortController().signal,
});
assert.match(wide.stdout, /中文 ok/);

const failed = await runPwsh({
  ...BASE,
  command: "exit 3",
  timeout_ms: 20_000,
  signal: new AbortController().signal,
});
assert.equal(failed.exit_code, 3);
assert.equal(failed.timed_out, false);

const capped = await runPwsh({
  ...BASE,
  command: "Write-Output ('x' * 5000)",
  max_output_bytes: 64,
  timeout_ms: 20_000,
  signal: new AbortController().signal,
});
assert.equal(capped.truncated, true);
assert.equal(capped.stdout.length, 64);

const cut = await runPwsh({
  ...BASE,
  command: "Start-Sleep -Seconds 30",
  timeout_ms: 400,
  signal: new AbortController().signal,
});
assert.equal(cut.timed_out, true);
assert.notEqual(cut.exit_code, 0);

const aborted = new AbortController();
aborted.abort();
const killed = await runPwsh({
  ...BASE,
  command: "Start-Sleep -Seconds 30",
  timeout_ms: 20_000,
  signal: aborted.signal,
});
assert.equal(killed.stdout, "");
assert.notEqual(killed.exit_code, 0);

console.log("pwsh-local ok: exit codes, utf8, timeout, cap, abort");