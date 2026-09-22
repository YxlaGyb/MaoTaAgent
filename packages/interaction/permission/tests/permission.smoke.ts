import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import {
  MODES,
  SCHEMA_VERSION,
  decide,
  effectiveMode,
  encodeDir,
  filePath,
  isMode,
  pairingProblems,
  read,
  sessionIdOf,
  subagentOf,
  write,
  type AskedRecord,
  type AuditRecord,
  type DecidedRecord,
} from "../src/store.ts";

const root = mkdtempSync(join(tmpdir(), "maota-permission-smoke-"));

try {
  assert.deepEqual([...MODES], ["ask", "auto", "full"]);
  assert.equal(isMode("ask"), true);
  assert.equal(isMode("yolo"), false);
  assert.equal(isMode(undefined), false);
  assert.equal(sessionIdOf("abc-1_x"), "abc-1_x");
  assert.throws(() => sessionIdOf("not a session"), CallError);

  assert.equal(encodeDir(""), "default");
  assert.equal(encodeDir("E:\\work\\"), "E--work");
  assert.equal(encodeDir("/home/me/"), "-home-me");
  assert.equal(filePath(root, "s1", "E:\\work"), join(root, "E--work", "s1.json"));

  assert.equal(subagentOf(undefined), undefined, "a call the session made itself names no subagent");
  assert.equal(subagentOf(null), undefined);
  assert.deepEqual(subagentOf({ id: "sub-1", type: "explore", description: "look at it" }), {
    id: "sub-1",
    type: "explore",
    description: "look at it",
  });
  assert.deepEqual(subagentOf({ id: "sub-1" }), { id: "sub-1" }, "the label is optional");
  assert.deepEqual(subagentOf({ id: "sub-1", type: "explore", description: null }), {
    id: "sub-1",
    type: "explore",
  });
  for (const bad of ["sub-1", 7, [], {}, { id: "" }, { id: "sub-1", type: 7 }]) {
    assert.throws(() => subagentOf(bad), CallError, `${JSON.stringify(bad)} should be refused`);
  }

  const empty = read(root, "s1", "E:\\work");
  assert.deepEqual(empty, {
    schema_version: SCHEMA_VERSION,
    session_id: "s1",
    cwd: "E:\\work",
    mode: null,
    records: [],
  });
  assert.equal(effectiveMode(empty, "ask"), "ask");
  assert.equal(effectiveMode({ ...empty, mode: "full" }, "ask"), "full");

  assert.deepEqual(decide("full", 0), { outcome: "allowed-once", decided_by: "policy:full" });
  assert.deepEqual(decide("auto", 3), { outcome: "allowed-once", decided_by: "policy:auto" });
  assert.deepEqual(decide("ask", 0), { outcome: "unavailable", decided_by: "none", cause: "no-answerer" });
  assert.equal(decide("ask", 2), "ask");

  const asked: AuditRecord = { kind: "asked", at: "t", id: "1", tool: "pwsh", call_id: "c-1", reason: "why" };
  const decided: AuditRecord = {
    kind: "decided",
    at: "t",
    id: "1",
    outcome: "allowed-once",
    decided_by: "web",
    tool: "pwsh",
  };
  const written = write(root, { ...empty, mode: "auto", records: [asked, decided] }, 10);
  assert.deepEqual(written.records, [asked, decided]);

  const back = read(root, "s1", "E:\\work");
  assert.equal(back.mode, "auto");
  assert.deepEqual(back.records, [asked, decided]);
  assert.deepEqual(pairingProblems(back.records), []);
  assert.deepEqual(pairingProblems([asked]), ["asked 1 has 0 decided records"]);
  assert.deepEqual(pairingProblems([decided]), ["decided 1 has no asked record and is not a policy decision"]);
  assert.deepEqual(pairingProblems([{ ...decided, decided_by: "policy:auto" }]), []);
  assert.deepEqual(pairingProblems([asked, decided, { ...decided }]), ["asked 1 has 2 decided records"]);

  const child: AuditRecord = {
    ...asked,
    id: "from-a-child",
    call_id: "task-call",
    subagent: { id: "sub-9f2a", type: "explore", description: "look at the loader" },
  };
  const answered: AuditRecord = { ...decided, id: "from-a-child", subagent: { id: "sub-9f2a" } };
  write(root, { ...empty, mode: "ask", records: [child, answered] }, 10);
  const audit = read(root, "s1", "E:\\work");
  const [askedBack, decidedBack] = audit.records as [AskedRecord, DecidedRecord];
  assert.deepEqual(askedBack.subagent, { id: "sub-9f2a", type: "explore", description: "look at the loader" });
  assert.deepEqual(decidedBack.subagent, { id: "sub-9f2a" }, "the answer should name the same child");
  assert.deepEqual(pairingProblems(audit.records), [], "a child's question still pairs with its answer");

  const many: AuditRecord[] = [];
  for (let index = 0; index < 4; index += 1) {
    many.push(
      { kind: "asked", at: "t", id: `p${index}`, tool: "pwsh" },
      { kind: "decided", at: "t", id: `p${index}`, outcome: "allowed-once", decided_by: "web", tool: "pwsh" },
    );
  }
  const trimmed = write(root, { ...empty, records: many }, 5);
  assert.equal(trimmed.records.length, 4);
  assert.equal(trimmed.records[0]?.kind, "asked");
  assert.deepEqual(pairingProblems(trimmed.records), []);

  const policyOnly: AuditRecord = {
    kind: "decided",
    at: "t",
    id: "x",
    outcome: "allowed-once",
    decided_by: "policy:auto",
    tool: "pwsh",
  };
  const kept = write(root, { ...empty, records: [{ ...asked, id: "policy-head" }, policyOnly, ...many] }, 3);
  assert.equal(kept.records.length <= 3, true);
  assert.deepEqual(pairingProblems(kept.records), []);

  mkdirSync(join(root, "default"), { recursive: true });
  writeFileSync(filePath(root, "s2", ""), "{not json");
  assert.deepEqual(read(root, "s2", "").records, []);
  writeFileSync(filePath(root, "s3", ""), JSON.stringify({ session_id: 7 }));
  assert.deepEqual(read(root, "s3", "").records, []);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("permission ok: the file model, the decision table and the audit pairing");

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "") as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the permission entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the permission selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [{ capability: "permission", version: "1.0.0" }]);
console.log("permission entry ok: the audit and subagent selfCheck report");
