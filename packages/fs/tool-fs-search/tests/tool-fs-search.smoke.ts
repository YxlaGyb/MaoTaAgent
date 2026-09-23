import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { CallError } from "@maota/plugin-kit";

import { globFiles } from "../src/glob.ts";
import { grepFiles } from "../src/grep.ts";
import { patternToRegExp } from "@maota/plugin-kit";

const OFF = { max_glob_results: 200, follow_links: false };
const ON = { max_glob_results: 200, follow_links: true };

function refused(run: () => unknown, label: string): void {
  assert.throws(run, CallError, `${label} should have been refused`);
}

for (const [pattern, path, wanted] of [
  ["!**/*.md", "src/a.ts", true],
  ["!**/*.md", "a.md", false],
  ["src/{a,b}/*.ts", "src/a/x.ts", true],
  ["src/{a,b}/*.ts", "src/c/x.ts", false],
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
  assert.deepEqual(all, {
    pattern: "**/*.txt",
    path: ".",
    count: 3,
    truncated: false,
    incomplete: false,
    skipped: 1,
    files: ["a.txt", "d.txt", "src/b.txt"],
  });

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
  const kept = grepFiles({ pattern: "keep" }, space, wide);
  assert.ok(
    kept.text.startsWith("src/code.ts\n  Line 1: keep me\n  Line 2: keep you too"),
    `hits should be grouped under their file, in line order: ${JSON.stringify(kept.text)}`,
  );
  assert.equal(kept.count, 2);
  assert.deepEqual(kept.matches, [
    { file: "src/code.ts", line: 1, text: "keep me" },
    { file: "src/code.ts", line: 2, text: "keep you too" },
  ]);
  assert.equal(kept.skipped, 1, "the junction the policy does not follow is counted, not silently missing");
  assert.equal(kept.incomplete, false);
  assert.ok(
    grepFiles({ pattern: "keep", include: "**/*.txt" }, space, wide).text.startsWith('no matches for "keep" below .'),
    "an include that matches nothing should say where it looked",
  );
  assert.equal(grepFiles({ pattern: "keep", path: "src" }, space, wide).text.startsWith("src/code.ts"), true);
  const cut = grepFiles({ pattern: "keep", path: "src" }, space, { ...wide, max_matches: 1 });
  assert.ok(cut.text.includes("max_matches of 1, so 1 more matches are not shown"), `a cut search said ${cut.text}`);
  assert.equal(cut.truncated, true, "a cut list says so as a field, not only in the sentence");
  assert.equal(cut.text.split("\n").filter((line) => line.startsWith("  ")).length, 1, "a cut list shows only the budget");
  refused(() => grepFiles({ pattern: "(" }, space, wide), "a broken regular expression");
  refused(() => grepFiles({ pattern: "keep", include: "!**/*.ts" }, space, wide), "a negating include");
  refused(() => grepFiles({ pattern: "keep", include: [7] }, space, wide), "an include list with a number in it");
  refused(() => grepFiles({ pattern: "keep", path: ".." }, space, wide), "an escaping search path");
  refused(() => grepFiles({ pattern: "keep", path: join(outside, "secret.txt") }, space, wide), "a search path outside");

  // An include list lets a file through if any pattern matches it.
  const both = grepFiles({ pattern: "keep", include: ["**/*.ts", "**/*.md"] }, space, wide);
  assert.equal(both.count, 2, "an include list should keep every file one of its patterns matches");

  // A pattern is tested against one line, unless `multiline` asks for the file.
  writeFileSync(join(root, "across.txt"), "gamma\ndelta\n");
  assert.equal(grepFiles({ pattern: "gamma\\s+delta" }, space, wide).count, 0, "by default nothing matches across a break");
  const across = grepFiles({ pattern: "gamma\\s+delta" }, space, { ...wide, multiline: true });
  assert.deepEqual(across.matches, [{ file: "across.txt", line: 1, text: "gamma delta" }], "a folded hit reads as one line");

  // The ignore files below the search root are read, `!` brings a file back,
  // and a hidden name is left out unless the pattern names it.
  mkdirSync(join(root, "build"), { recursive: true });
  writeFileSync(join(root, "build", "out.txt"), "built\n");
  writeFileSync(join(root, "vendor.txt"), "vendored\n");
  writeFileSync(join(root, "keep.txt"), "kept\n");
  writeFileSync(join(root, ".hidden.txt"), "hidden\n");
  writeFileSync(join(root, ".gitignore"), "build/\nvendor.txt\n!keep.txt\n");
  const ruled = globFiles({ pattern: "**/*.txt" }, space, OFF);
  assert.deepEqual(ruled.files, ["a.txt", "across.txt", "d.txt", "keep.txt", "src/b.txt"], "a rule keeps a file out and `!` brings one back");
  assert.ok(ruled.skipped >= 4, `the walk should count what it left out, not ${ruled.skipped}`);
  const dotted = globFiles({ pattern: "**/.*" }, space, { ...OFF, dotfiles: true });
  assert.ok(dotted.files.includes(".hidden.txt"), "a pattern that names a hidden segment should reach it");
  rmSync(join(root, "build"), { recursive: true, force: true });
  rmSync(join(root, ".gitignore"), { force: true });
  rmSync(join(root, "vendor.txt"), { force: true });
  rmSync(join(root, "keep.txt"), { force: true });
  rmSync(join(root, ".hidden.txt"), { force: true });
  rmSync(join(root, "across.txt"), { force: true });

  console.log("tool-fs-search ok: patterns, ordering, caps, links, refusals, and the grep grouping");
} finally {
  rmSync(join(root, "link"), { force: true });
  rmSync(base, { recursive: true, force: true });
}

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
const report = JSON.parse((run.stdout ?? "").trim().split("\n").at(-1) ?? "") as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(run.status, 0, `the tool entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
assert.equal(report.ok, true, `the tool selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["tool.glob", "tool.grep"]);
console.log("tool-fs-search entry ok: the glob and grep selfCheck report");
