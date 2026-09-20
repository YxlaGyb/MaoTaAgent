import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { editFile } from "../src/edit.ts";
import { readFile } from "../src/read.ts";
import { writeFile } from "../src/write.ts";

const BUDGET = { max_read_bytes: 256 * 1024, max_write_bytes: 1024 * 1024 };

function refused(run: () => unknown, label: string): void {
  assert.throws(run, CallError, `${label} should have been refused`);
}

const base = mkdtempSync(join(tmpdir(), "maota-tool-fs-smoke-"));
const root = join(base, "work");
const outside = join(base, "outside");
const spill = join(base, "spill");
mkdirSync(root, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, "secret.txt"), "secret\n");

try {
  const space = workspace(root, spill);
  assert.equal(space.root, root);
  assert.deepEqual(space.read_roots, [root, spill]);

  const created = writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, BUDGET);
  assert.deepEqual(created, { path: "a/b.txt", bytes: 14, created: true });
  assert.equal(writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, BUDGET).created, false);

  assert.equal(readFile({ file_path: "a/b.txt" }, space, BUDGET), "1| one\n2| two\n3| three");
  assert.equal(
    readFile({ file_path: "a/b.txt", offset: 2, limit: 1 }, space, BUDGET),
    "2| two\n\n(showed lines 2-2 of 3; continue with offset=3)",
  );
  assert.equal(readFile({ file_path: join(root, "a", "b.txt") }, space, BUDGET), "1| one\n2| two\n3| three");

  assert.deepEqual(editFile({ file_path: "a/b.txt", old_string: "two", new_string: "TWO" }, space, BUDGET), {
    path: "a/b.txt",
    replaced: 1,
    bytes: 14,
  });
  assert.equal(readFile({ file_path: "a/b.txt" }, space, BUDGET), "1| one\n2| TWO\n3| three");

  writeFile({ file_path: "long.txt", content: `${"x".repeat(20)}\n`.repeat(60) }, space, BUDGET);
  assert.match(readFile({ file_path: "long.txt" }, space, { max_read_bytes: 40 }), /byte cap/);
  refused(() => readFile({ file_path: "long.txt", offset: 500 }, space, BUDGET), "an offset past the end");
  refused(() => readFile({ file_path: "long.txt", limit: 0 }, space, BUDGET), "a zero line limit");

  writeFile({ file_path: "twice.txt", content: "two and two\n" }, space, BUDGET);
  refused(
    () => editFile({ file_path: "twice.txt", old_string: "two", new_string: "x" }, space, BUDGET),
    "an ambiguous edit",
  );
  assert.equal(
    editFile({ file_path: "twice.txt", old_string: "two", new_string: "x", replace_all: true }, space, BUDGET).replaced,
    2,
  );
  refused(
    () => editFile({ file_path: "twice.txt", old_string: "nope", new_string: "x" }, space, BUDGET),
    "a missing old_string",
  );
  refused(
    () => editFile({ file_path: "missing.txt", old_string: "a", new_string: "b" }, space, BUDGET),
    "a missing file",
  );
  refused(() => editFile({ file_path: "twice.txt", old_string: "", new_string: "x" }, space, BUDGET), "an empty search");

  refused(() => readFile({ file_path: "nothing.txt" }, space, BUDGET), "a missing file");
  refused(() => readFile({ file_path: "a" }, space, BUDGET), "a directory");
  refused(() => readFile({ file_path: "../outside/secret.txt" }, space, BUDGET), "a parent escape");
  refused(() => readFile({ file_path: join(outside, "secret.txt") }, space, BUDGET), "an absolute path outside");
  refused(() => writeFile({ file_path: "a/b.txt:stream", content: "x" }, space, BUDGET), "an alternate data stream");
  refused(() => writeFile({ file_path: "a/b.", content: "x" }, space, BUDGET), "a trailing dot");
  refused(() => writeFile({ file_path: "a/b ", content: "x" }, space, BUDGET), "a trailing space");
  refused(() => writeFile({ file_path: "", content: "x" }, space, BUDGET), "an empty path");
  refused(
    () => writeFile({ file_path: "big.txt", content: "x".repeat(50) }, space, { ...BUDGET, max_write_bytes: 10 }),
    "an oversized write",
  );
  refused(() => workspace(""), "an empty working directory");
  refused(() => workspace(join(base, "nope"), spill), "a missing working directory");

  const spilled = join(spill, "note.txt");
  mkdirSync(spill, { recursive: true });
  writeFileSync(spilled, "spilled text\n");
  assert.equal(readFile({ file_path: spilled }, space, BUDGET), "1| spilled text");
  refused(() => writeFile({ file_path: spilled, content: "x" }, space, BUDGET), "a write outside the workspace");

  console.log("tool-fs ok: round trip, caps, edits, spill reads, every refusal");
} finally {
  rmSync(base, { recursive: true, force: true });
}