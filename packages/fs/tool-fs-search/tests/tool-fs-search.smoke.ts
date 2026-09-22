import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { globFiles } from "../src/glob.ts";
import { grepFiles } from "../src/grep.ts";
import { patternToRegExp } from "../src/walk.ts";

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
writeFileSync(join(root, "src", "code.ts"), "keep me\nkeep you too\n");
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

  const wide = { follow_links: false, max_matches: 50, max_line_chars: 200, max_file_bytes: 4096 };
  assert.equal(
    grepFiles({ pattern: "keep" }, space, wide),
    "src/code.ts\n  Line 1: keep me\n  Line 2: keep you too",
    "hits should be grouped under their file, in line order",
  );
  assert.equal(grepFiles({ pattern: "keep", include: "**/*.txt" }, space, wide), 'no matches for "keep" below .');
  assert.equal(grepFiles({ pattern: "keep", path: "src" }, space, wide).startsWith("src/code.ts"), true);
  const cut = grepFiles({ pattern: "keep", path: "src" }, space, { ...wide, max_matches: 1 });
  assert.ok(cut.includes("max_matches of 1, so 1 more matches are not shown"), `a cut search said ${cut}`);
  assert.equal(cut.split("\n").filter((line) => line.startsWith("  ")).length, 1, "a cut list shows only the budget");
  refused(() => grepFiles({ pattern: "(" }, space, wide), "a broken regular expression");
  refused(() => grepFiles({ pattern: "keep", include: "**/*.ts,**/*.md" }, space, wide), "a comma list");
  refused(() => grepFiles({ pattern: "keep", path: ".." }, space, wide), "an escaping search path");
  refused(() => grepFiles({ pattern: "keep", path: join(outside, "secret.txt") }, space, wide), "a search path outside");

  console.log("tool-fs-search ok: patterns, ordering, caps, links, refusals, and the grep grouping");
} finally {
  rmSync(join(root, "link"), { force: true });
  rmSync(base, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "") as {
  ok?: boolean;
  provides?: Array<{ capability: string; version: string }>;
  problems?: string[];
};
assert.equal(run.status, 0, `the tool entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the tool selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, [
  { capability: "tool.glob", version: "1.0.0" },
  { capability: "tool.grep", version: "1.0.0" },
]);
console.log("tool-fs-search entry ok: the glob and grep selfCheck report");
