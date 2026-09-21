import assert from "node:assert/strict";

import type { Call } from "@maota/plugin-kit";

import { needsApproval, reasonOf, refusalOf, requestApproval } from "../src/approval.ts";
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

assert.equal(needsApproval("Get-ChildItem"), false);
assert.equal(needsApproval("rm -rf build"), true, "the first shape is a literal match");
assert.equal(needsApproval("echo x > /etc/hosts"), true, "the second shape is a literal match");
assert.equal(needsApproval("chmod 777 ."), true, "the third shape is a literal match");
assert.equal(
  needsApproval("Remove-Item -Recurse build"),
  false,
  "nothing here classifies a command: the shapes are literal",
);
assert.equal(reasonOf("rm -rf build").includes('"rm "'), true, "the reason should name the shape that hit");

assert.deepEqual(refusalOf("rm -rf build", "rejected"), {
  command: "rm -rf build",
  status: "approval denied",
  ok: false,
  reason: "the user rejected this command, so it did not run",
});
assert.equal(refusalOf("x", "cancelled").ok, false);
assert.equal(refusalOf("x", "unavailable").reason.includes("no approval answerer"), true);

const answered = async (reply: () => unknown): Promise<string> => {
  const call = {
    signal: new AbortController().signal,
    channel: { call: async () => reply() },
  } as unknown as Call;
  return await requestApproval(call, { session_id: "s", cwd: "", tool: "pwsh" }, 1000);
};

assert.equal(await answered(() => ({ outcome: "allowed-once" })), "allowed-once");
assert.equal(await answered(() => ({ outcome: "rejected" })), "rejected");
assert.equal(await answered(() => ({ outcome: "cancelled" })), "cancelled");
assert.equal(await answered(() => ({ outcome: "unavailable" })), "unavailable");
assert.equal(await answered(() => ({ outcome: "sure" })), "unavailable", "a word outside the four is a refusal");
assert.equal(await answered(() => null), "unavailable");
assert.equal(await answered(() => undefined), "unavailable");
assert.equal(
  await answered(() => {
    throw new Error("no permission capability here");
  }),
  "unavailable",
  "a call that threw is a refusal, never a grant",
);

console.log("tool-pwsh ok: result rendering, the approval vocabulary and the refusals");
