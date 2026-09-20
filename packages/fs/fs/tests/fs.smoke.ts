import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CallError } from "@maota/plugin-kit";

import { resolvePath, workspace } from "../src/paths.ts";
import { writeAtomic } from "../src/atomic.ts";

function refused(run: () => unknown, label: string): void {
  assert.throws(run, CallError, `${label} should have been refused`);
}

const base = mkdtempSync(join(tmpdir(), "maota-fs-smoke-"));
const root = join(base, "work");
const outside = join(base, "outside");
const spill = join(base, "spill");
mkdirSync(root, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, "secret.txt"), "secret\n");
symlinkSync(outside, join(root, "link"), "junction");

try {
  const space = workspace(root, spill);
  assert.equal(space.root, root);
  assert.deepEqual(space.read_roots, [root, spill]);
  assert.deepEqual(workspace(root).read_roots, [root]);
  assert.deepEqual(workspace(root, "").read_roots, [root]);

  assert.equal(resolvePath({ path: "a/b.txt", roots: [root] }), join(root, "a", "b.txt"));
  assert.equal(resolvePath({ path: join(root, "a", "b.txt"), roots: [root] }), join(root, "a", "b.txt"));
  assert.equal(resolvePath({ path: ".", roots: [root] }), root);

  refused(() => resolvePath({ path: "", roots: [root] }), "an empty path");
  refused(() => resolvePath({ path: "   ", roots: [root] }), "a blank path");
  refused(() => resolvePath({ path: "a", roots: [] }), "a path with no roots");
  refused(() => resolvePath({ path: "../escape.txt", roots: [root] }), "a parent escape");
  refused(() => resolvePath({ path: join(base, "escape.txt"), roots: [root] }), "an absolute path outside");
  refused(() => resolvePath({ path: join(outside, "secret.txt"), roots: [root] }), "a sibling tree");
  refused(() => resolvePath({ path: "link/secret.txt", roots: [root] }), "a junction escape");
  refused(() => resolvePath({ path: "a/b.txt:stream", roots: [root] }), "an alternate data stream");
  refused(() => resolvePath({ path: "a/b.", roots: [root] }), "a trailing dot");
  refused(() => resolvePath({ path: "a/b ", roots: [root] }), "a trailing space");
  refused(() => resolvePath({ path: "a\0b", roots: [root] }), "a null byte");
  refused(() => resolvePath({ path: "link", roots: [root], write: true }), "a write onto a link");
  refused(() => resolvePath({ path: "link", roots: [root] }), "the link itself");
  refused(() => resolvePath({ path: "..\\..\\x", roots: [root] }), "an alternate separator escape");

  refused(() => workspace(join(base, "nope"), spill), "a missing working directory");
  refused(() => workspace("", spill), "an empty working directory");
  writeFileSync(join(base, "plain.txt"), "x\n");
  refused(() => workspace(join(base, "plain.txt"), spill), "a working directory that is a file");

  const target = join(root, "deep", "note.txt");
  writeAtomic(target, "first\n");
  assert.equal(readFileSync(target, "utf8"), "first\n");
  writeAtomic(target, "second\n");
  assert.equal(readFileSync(target, "utf8"), "second\n");
  assert.deepEqual(readdirSync(join(root, "deep")), ["note.txt"]);

  console.log("fs ok: containment, portability refusals, atomic write");
} finally {
  rmSync(base, { recursive: true, force: true });
}