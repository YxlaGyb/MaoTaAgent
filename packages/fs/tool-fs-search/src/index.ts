#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { defineTools, patternToRegExp, runPlugin, type Definition } from "@maota/plugin-kit";

import { globFiles } from "./glob.ts";
import { grepFiles } from "./grep.ts";

const DEFAULTS = {
  max_glob_results: 200,
  follow_links: false,
  max_matches: 250,
  max_line_chars: 2000,
  max_file_bytes: 1024 * 1024,
};

let settings = { ...DEFAULTS };

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/// A name that starts with a dot is kept out of a walk unless the caller named
/// a hidden segment itself, so `**/*.ts` never reports `.config.ts` and
/// `**/.env` does.
function wantsDotfiles(value: unknown): boolean {
  return typeof value === "string" && /(^|[/\\])\./.test(value);
}

const toolkit = defineTools([
  {
    capability: "tool.glob",
    description:
      "Find files by path pattern, such as **/*.ts, below the working directory. A leading ! negates the pattern " +
      "and {a,b} offers alternatives. Files ruled out by a .gitignore, and hidden names the pattern does not name " +
      "itself, are left out and counted in skipped.",
    parameters: {
      pattern: {
        type: "string",
        required: true,
        description: "Pattern matched against paths below the search directory; ! negates and {a,b} offers alternatives.",
      },
      path: { type: "string", description: "Directory to search, relative to the working directory; the whole tree by default." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    paths: ["path"],
    run: (args) =>
      globFiles(args, workspace(args.cwd), {
        ...settings,
        dotfiles: wantsDotfiles(args.pattern),
      }),
  },
  {
    capability: "tool.grep",
    description:
      "Search file contents with a regular expression, below the working directory; each match comes back as the file " +
      "path, the line number and the matching line, grouped by file and ordered by path and line.",
    parameters: {
      pattern: { type: "string", required: true, description: "Regular expression matched against each line." },
      path: { type: "string", description: "Directory to search, relative to the working directory; the whole tree by default." },
      include: {
        type: "array",
        items: { type: "string" },
        description: "Search only files whose path matches one of these globs, such as **/*.ts.",
      },
      multiline: {
        type: "boolean",
        description: "Let the pattern match across line breaks; a hit then reads as one folded line.",
      },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    paths: ["path"],
    run: (args) => grepFiles(args, workspace(args.cwd), { ...settings, multiline: args.multiline === true }),
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  configKeys: ["max_glob_results", "follow_links", "max_matches", "max_line_chars", "max_file_bytes"],

  setup(wiring) {
    settings = {
      max_glob_results: positive(wiring.config.max_glob_results, DEFAULTS.max_glob_results),
      follow_links: wiring.config.follow_links === true,
      max_matches: positive(wiring.config.max_matches, DEFAULTS.max_matches),
      max_line_chars: positive(wiring.config.max_line_chars, DEFAULTS.max_line_chars),
      max_file_bytes: positive(wiring.config.max_file_bytes, DEFAULTS.max_file_bytes),
    };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const capabilities = toolkit.provides;
    if (capabilities.join(",") !== "tool.glob,tool.grep") {
      problems.push(`the toolkit provides ${capabilities.join(", ")}`);
    }
    for (const [pattern, path, wanted] of [
      ["**/*.ts", "src/a.ts", true],
      ["**/*.ts", "a.ts", true],
      ["*.md", "src/a.md", false],
      ["src/**/*.ts", "src/x/a.ts", true],
      ["src/**/*.ts", "other/a.ts", false],
      ["a?c.ts", "abc.ts", true],
      ["a?c.ts", "a/c.ts", false],
    ] as Array<[string, string, boolean]>) {
      if (patternToRegExp(pattern).test(path) !== wanted) {
        problems.push(`${pattern} matched ${path} wrongly`);
      }
    }

    const dir = mkdtempSync(join(tmpdir(), "maota-tool-fs-search-"));
    try {
      const space = workspace(dir);
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "a.ts"), "a\n");
      writeFileSync(join(dir, "b.md"), "b\n");
      writeFileSync(join(dir, "notes.txt"), "alpha\nbeta\n");
      writeFileSync(join(dir, "src", "code.ts"), "alpha one\nalpha two\n");
      writeFileSync(join(dir, "blob.bin"), Buffer.from([0x61, 0x00, 0x6c, 0x70, 0x68, 0x61]));
      writeFileSync(join(dir, ".hidden.ts"), "hidden\n");
      writeFileSync(join(dir, "across.txt"), "gamma\ndelta\n");
      writeFileSync(join(dir, "keep.md"), "kept\n");
      mkdirSync(join(dir, "build"), { recursive: true });
      writeFileSync(join(dir, "build", "out.ts"), "built\n");
      writeFileSync(join(dir, "vendor.ts"), "vendored\n");
      writeFileSync(join(dir, ".gitignore"), "build/\nvendor.ts\n!keep.md\n");
      const found = globFiles({ pattern: "**/*.ts" }, space, { max_glob_results: 10, follow_links: false });
      if (found.count !== 2 || !found.files.includes("src/a.ts") || !found.files.includes("src/code.ts")) {
        problems.push(`glob reported ${JSON.stringify(found)}`);
      }
      const scoped = globFiles({ pattern: "**/*.md", path: "src" }, space, { max_glob_results: 10, follow_links: false });
      if (scoped.count !== 0) problems.push(`a scoped glob reported ${JSON.stringify(scoped)}`);
      const capped = globFiles({ pattern: "**/*", path: "." }, space, { max_glob_results: 1, follow_links: false });
      if (!capped.truncated || capped.count !== 1) problems.push(`a capped glob reported ${JSON.stringify(capped)}`);
      try {
        globFiles({ pattern: "**/*", path: ".." }, space, { max_glob_results: 10, follow_links: false });
        problems.push("glob accepted an escaping path");
      } catch {
      }
      try {
        globFiles({ pattern: "   " }, space, { max_glob_results: 10, follow_links: false });
        problems.push("glob accepted a blank pattern");
      } catch {
      }

      const wide = { follow_links: false, max_matches: 250, max_line_chars: 2000, max_file_bytes: 1024 };
      const matched = grepFiles({ pattern: "alpha" }, space, wide);
      const wanted =
        "notes.txt\n  Line 1: alpha\nsrc/code.ts\n  Line 1: alpha one\n  Line 2: alpha two";
      if (!matched.text.startsWith(wanted)) problems.push(`grep rendered ${JSON.stringify(matched.text)}`);
      if (!matched.text.includes("1 files skipped as binary")) problems.push(`grep skipped ${JSON.stringify(matched.text)}`);
      const single = grepFiles({ pattern: "beta" }, space, wide);
      if (!single.text.startsWith("notes.txt\n  Line 2: beta")) {
        problems.push(`a one match search rendered ${JSON.stringify(single.text)}`);
      }
      if (!grepFiles({ pattern: "alpha", include: "**/*.ts" }, space, wide).text.startsWith("src/code.ts")) {
        problems.push("include did not narrow the search to the TypeScript file");
      }
      const included = grepFiles({ pattern: "alpha", include: ["**/*.ts", "**/*.txt"] }, space, wide);
      if (included.count !== 3 || !included.text.includes("notes.txt") || !included.text.includes("src/code.ts")) {
        problems.push(`an include list rendered ${JSON.stringify(included.text)}`);
      }
      if (!grepFiles({ pattern: "alpha", include: "*.ts" }, space, wide).text.startsWith("no matches for")) {
        problems.push("a bare include pattern matched below the root");
      }
      const under = grepFiles({ pattern: "alpha", path: "src" }, space, wide);
      if (!under.text.startsWith("src/code.ts") || under.text.includes("notes.txt")) {
        problems.push(`grep ignored the path argument: ${JSON.stringify(under.text)}`);
      }
      const budgeted = grepFiles({ pattern: "alpha", path: "src" }, space, { ...wide, max_matches: 1 });
      if (!budgeted.text.includes("max_matches of 1, so 1 more matches are not shown")) {
        problems.push(`a capped grep said ${JSON.stringify(budgeted.text)}`);
      }
      if (budgeted.text.split("\n").filter((line) => line.startsWith("  ")).length !== 1) {
        problems.push(`a capped grep showed ${JSON.stringify(budgeted.text)}`);
      }
      if (!budgeted.truncated) problems.push("a capped grep did not say its answer was truncated");
      if (!grepFiles({ pattern: "alpha" }, space, { ...wide, max_line_chars: 5 }).text.includes("  Line 1: alpha…")) {
        problems.push("grep did not clip a long line");
      }
      const narrowed = grepFiles({ pattern: "alpha" }, space, { ...wide, max_file_bytes: 8 });
      if (!narrowed.text.startsWith("no matches for") || !narrowed.text.includes("4 files skipped as binary")) {
        problems.push(`a byte capped search rendered ${JSON.stringify(narrowed.text)}`);
      }
      if (!grepFiles({ pattern: "nothing here" }, space, wide).text.startsWith('no matches for "nothing here" below .')) {
        problems.push("an empty search did not say where it looked");
      }
      for (const [args, why] of [
        [{ pattern: "(" }, "pattern"],
        [{ pattern: "   " }, "pattern"],
        [{ pattern: "alpha", include: "!**/*.md" }, "negation"],
        [{ pattern: "alpha", include: 7 }, "non-string include"],
        [{ pattern: "alpha", include: [7] }, "non-string include element"],
        [{ pattern: "alpha", include: [""] }, "blank include"],
      ] as Array<[Record<string, unknown>, string]>) {
        try {
          grepFiles(args, space, wide);
          problems.push(`grep accepted a bad ${why}`);
        } catch {
        }
      }
      try {
        grepFiles({ pattern: "alpha", path: ".." }, space, wide);
        problems.push("grep accepted an escaping path");
      } catch {
      }

      // A leading `!` negates a pattern, and `{a,b}` offers alternatives.
      for (const [pattern, path, wanted] of [
        ["!**/*.md", "src/a.ts", true],
        ["!**/*.md", "b.md", false],
        ["src/{a,code}.ts", "src/a.ts", true],
        ["src/{a,code}.ts", "src/code.ts", true],
        ["src/{a,code}.ts", "src/other.ts", false],
      ] as Array<[string, string, boolean]>) {
        if (patternToRegExp(pattern).test(path) !== wanted) {
          problems.push(`${pattern} matched ${path} wrongly`);
        }
      }

      // A `.gitignore` in the tree is read, `!` brings a file back, and every
      // name it keeps out is counted rather than silently missing.
      const ignoredWalk = globFiles({ pattern: "**/*" }, space, { max_glob_results: 50, follow_links: false });
      if (ignoredWalk.files.includes("build/out.ts") || ignoredWalk.files.includes("vendor.ts")) {
        problems.push(`glob ignored no rule: ${JSON.stringify(ignoredWalk.files)}`);
      }
      if (!ignoredWalk.files.includes("keep.md")) {
        problems.push(`a negated rule did not bring a file back: ${JSON.stringify(ignoredWalk.files)}`);
      }
      if (ignoredWalk.skipped < 4) problems.push(`glob counted ${ignoredWalk.skipped} skipped entries`);
      if (!ignoredWalk.files.includes("src/a.ts") || ignoredWalk.files.includes(".hidden.ts")) {
        problems.push(`a hidden name was not kept out: ${JSON.stringify(ignoredWalk.files)}`);
      }
      const hidden = globFiles({ pattern: "**/.*", path: "." }, space, { max_glob_results: 50, follow_links: false, dotfiles: true });
      if (!hidden.files.some((file) => file.endsWith(".hidden.ts"))) {
        problems.push(`a pattern naming a hidden segment found nothing: ${JSON.stringify(hidden.files)}`);
      }
      if (hidden.incomplete) problems.push("a short walk reported itself incomplete");

      // A pattern is tested against one line unless `multiline` asks otherwise,
      // and a hit that crossed a break reads as one folded line.
      const oneLine = grepFiles({ pattern: "gamma\\s+delta" }, space, wide);
      if (oneLine.count !== 0) problems.push(`a line-at-a-time search matched across a break: ${JSON.stringify(oneLine.text)}`);
      const across = grepFiles({ pattern: "gamma\\s+delta", multiline: true }, space, { ...wide, multiline: true });
      if (across.count !== 1 || !across.matches[0]?.text.includes("gamma delta")) {
        problems.push(`a multiline search rendered ${JSON.stringify(across)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
