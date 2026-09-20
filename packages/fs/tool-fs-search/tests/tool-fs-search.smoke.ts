import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { globFiles, patternToRegExp } from "../src/glob.ts";

const OFF = { max_glob_results: 200, follow_links: false };
const ON = { max_glob_results: 200, follow_links: true };

function refused(run: () => unknown, label: string): void {
  assert.throws(run, CallError, `${label} should have been refused`);
}

for (const [pattern, path, wanted] of [
  ["**/*.ts", "src/a.ts", true],
  ["**/*.ts", "a.ts", true],
  ["*.md", "src/a.md", false],
  ["src/**/*.ts", "src/x/a.ts", true],
  ["src/**/*.ts", "other/a.ts", false],
  ["a?c.ts", "abc.ts", true],
  ["a?c.ts", "a/c.ts", false],
  ["a.b.ts", "axb.ts", false],
  ["**", "deep/inside.txt", true],
] as Array<[string, string, boolean]>) {
  assert.equal(patternToRegExp(pattern).test(path), wanted, `${pattern} against ${path}`);
}

const base = mkdtempSync(join(tmpdir(), "maota-tool-fs-search-smoke-"));
const root = join(base, "work");
const outside = join(base, "outside");
mkdirSync(root, { recursive: true });
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(root, "d.txt"), "d\n");
writeFileSync(join(root, "a.txt"), "a\n");
writeFileSync(join(root, "src", "b.txt"), "b\n");
writeFileSync(join(root, "src", "note.md"), "#\n");
writeFileSync(join(outside, "secret.txt"), "s\n");
symlinkSync(outside, join(root, "link"), "junction");

try {
  const space = workspace(root);
  const all = globFiles({ pattern: "**/*.txt" }, space, OFF);
  assert.deepEqual(all.files, ["a.txt", "d.txt", "src/b.txt"]);
  assert.deepEqual(all, { pattern: "**/*.txt", path: ".", count: 3, truncated: false, files: ["a.txt", "d.txt", "src/b.txt"] });

  assert.deepEqual(globFiles({ pattern: "**/*.txt" }, space, ON).files, [
    "a.txt",
    "d.txt",
    "link/secret.txt",
    "src/b.txt",
  ]);
  assert.deepEqual(globFiles({ pattern: "*.txt" }, space, OFF).files, ["a.txt", "d.txt"]);
  assert.deepEqual(globFiles({ pattern: "**/*.md" }, space, OFF).files, ["src/note.md"]);
  assert.deepEqual(globFiles({ pattern: "**/*.md", path: "src" }, space, OFF).files, ["src/note.md"]);

  assert.deepEqual(globFiles({ pattern: "*.ts" }, space, OFF).files, []);

  const capped = globFiles({ pattern: "**/*.txt" }, space, { max_glob_results: 2, follow_links: false });
  assert.equal(capped.count, 2);
  assert.equal(capped.truncated, true);


  refused(() => globFiles({ pattern: "  " }, space, OFF), "a blank pattern");
  refused(() => globFiles({ pattern: "**/*", path: ".." }, space, OFF), "an escaping path");
  refused(() => globFiles({ pattern: "**/*", path: join(outside, "secret.txt") }, space, OFF), "a path outside");
  refused(() => globFiles({ pattern: "**/*", path: "nope" }, space, OFF), "a missing directory");
  refused(() => globFiles({ pattern: "**/*", path: "a.txt" }, space, OFF), "a file as the search path");

  console.log("tool-fs-search ok: patterns, ordering, caps, links, refusals");
} finally {
  rmSync(join(root, "link"), { force: true });
  rmSync(base, { recursive: true, force: true });
}