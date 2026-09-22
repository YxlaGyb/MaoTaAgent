import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pendingFileLocks, workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { editFile } from "../src/edit.ts";
import { readFile } from "../src/read.ts";
import { writeFile } from "../src/write.ts";

const BUDGET = { max_read_bytes: 256 * 1024, max_write_bytes: 1024 * 1024 };

async function refused(run: () => unknown, label: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof CallError, `${label}: ${String(error)}`);
    return;
  }
  assert.fail(`${label} should have been refused`);
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

  const created = await writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, BUDGET);
  assert.deepEqual(created, { path: "a/b.txt", bytes: 14, created: true, mode: "replace" });
  assert.equal((await writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, BUDGET)).created, false);

  assert.equal(readFile({ file_path: "a/b.txt" }, space, BUDGET), "1| one\n2| two\n3| three");
  assert.equal(
    readFile({ file_path: "a/b.txt", offset: 2, limit: 1 }, space, BUDGET),
    "2| two\n\n(showed lines 2-2 of 3; continue with offset=3)",
  );
  assert.equal(readFile({ file_path: join(root, "a", "b.txt") }, space, BUDGET), "1| one\n2| two\n3| three");

  assert.deepEqual(await editFile({ file_path: "a/b.txt", old_string: "two", new_string: "TWO" }, space, BUDGET), {
    path: "a/b.txt",
    replaced: 1,
    bytes: 14,
  });
  assert.equal(readFile({ file_path: "a/b.txt" }, space, BUDGET), "1| one\n2| TWO\n3| three");

  const appended = await writeFile({ file_path: "a/b.txt", content: "four\n", mode: "append" }, space, BUDGET);
  assert.equal(appended.mode, "append");
  assert.equal(appended.created, false);
  assert.equal(readFile({ file_path: "a/b.txt" }, space, BUDGET), "1| one\n2| TWO\n3| three\n4| four");
  assert.equal(
    readFile({ file_path: "a/b.txt", from_byte: Buffer.byteLength("one\nTWO\n") }, space, BUDGET),
    "3| three\n4| four\n\n(this read started at byte 8, which is line 3)",
  );
  await refused(
    () => writeFile({ file_path: "a/b.txt", content: "x", mode: "merge" }, space, BUDGET),
    "an unknown write mode",
  );

  writeFileSync(join(root, "long.txt"), `${"x".repeat(20)}\n`.repeat(60));
  assert.match(readFile({ file_path: "long.txt" }, space, { max_read_bytes: 40 }), /byte cap/);
  refused(() => readFile({ file_path: "long.txt", offset: 500 }, space, BUDGET), "an offset past the end");
  refused(() => readFile({ file_path: "long.txt", limit: 0 }, space, BUDGET), "a zero line limit");
  refused(() => readFile({ file_path: "long.txt", from_byte: -1 }, space, BUDGET), "a negative byte offset");

  writeFileSync(join(root, "twice.txt"), "two and two\n");
  await refused(
    () => editFile({ file_path: "twice.txt", old_string: "two", new_string: "x" }, space, BUDGET),
    "an ambiguous edit",
  );
  assert.equal(
    (await editFile({ file_path: "twice.txt", old_string: "two", new_string: "x", replace_all: true }, space, BUDGET))
      .replaced,
    2,
  );
  await refused(
    () => editFile({ file_path: "twice.txt", old_string: "nope", new_string: "x" }, space, BUDGET),
    "a missing old_string",
  );
  refused(() => editFile({ file_path: "missing.txt", old_string: "a", new_string: "b" }, space, BUDGET), "a missing file");
  await refused(() => editFile({ file_path: "twice.txt", old_string: "", new_string: "x" }, space, BUDGET), "an empty search");

  // A replacement that straddles the block boundary is still found, and the
  // file comes back the same size plus the difference the edit made.
  const boundary = 64 * 1024 - 6;
  const needle = "NEEDLEACROSS";
  writeFileSync(join(root, "big.txt"), `${"x".repeat(boundary)}${needle}${"z".repeat(20)}`);
  const crossed = await editFile({ file_path: "big.txt", old_string: needle, new_string: "FOUND" }, space, BUDGET);
  assert.equal(crossed.replaced, 1, "a match across a block boundary should be replaced once");
  const after = readFileSync(join(root, "big.txt"), "utf8");
  assert.ok(!after.includes(needle) && after.includes("FOUND"), "the boundary edit left the wrong text");
  assert.equal(after.length, boundary + "FOUND".length + 20);
  assert.equal(pendingFileLocks(), 0, "every lock should be off the books once the write is done");
  assert.deepEqual(
    readdirSync(root).filter((name) => name.endsWith(".lock") || name.endsWith(".tmp")),
    [],
    "no lock or temporary file should survive a write",
  );

  refused(() => readFile({ file_path: "nothing.txt" }, space, BUDGET), "a missing file");
  refused(() => readFile({ file_path: "a" }, space, BUDGET), "a directory");
  refused(() => readFile({ file_path: "../outside/secret.txt" }, space, BUDGET), "a parent escape");
  refused(() => readFile({ file_path: join(outside, "secret.txt") }, space, BUDGET), "an absolute path outside");
  await refused(() => writeFile({ file_path: "a/b.txt:stream", content: "x" }, space, BUDGET), "an alternate data stream");
  await refused(() => writeFile({ file_path: "a/b.", content: "x" }, space, BUDGET), "a trailing dot");
  await refused(() => writeFile({ file_path: "a/b ", content: "x" }, space, BUDGET), "a trailing space");
  await refused(() => writeFile({ file_path: "", content: "x" }, space, BUDGET), "an empty path");
  await refused(
    () => writeFile({ file_path: "big.txt", content: "x".repeat(50) }, space, { ...BUDGET, max_write_bytes: 10 }),
    "an oversized write",
  );
  await refused(
    () => writeFile({ file_path: "a/b.txt", content: "x".repeat(50), mode: "append" }, space, { ...BUDGET, max_write_bytes: 20 }),
    "an append that would pass the cap",
  );
  refused(() => workspace(""), "an empty working directory");
  refused(() => workspace(join(base, "nope"), spill), "a missing working directory");

  const spilled = join(spill, "note.txt");
  mkdirSync(spill, { recursive: true });
  writeFileSync(spilled, "spilled text\n");
  assert.equal(readFile({ file_path: spilled }, space, BUDGET), "1| spilled text");
  await refused(() => writeFile({ file_path: spilled, content: "x" }, space, BUDGET), "a write outside the workspace");

  console.log("tool-fs ok: round trip, caps, appends, byte offsets, block edits, spill reads, every refusal");
} finally {
  rmSync(base, { recursive: true, force: true });
}