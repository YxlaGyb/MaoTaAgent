#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { defineTools, runPlugin, type Definition } from "@maota/plugin-kit";

import { globFiles } from "./glob.ts";
import { grepFiles } from "./grep.ts";
import { patternToRegExp } from "./walk.ts";

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

const toolkit = defineTools([
  {
    capability: "tool.glob",
    version: "1.0.0",
    description: "Find files by path pattern, such as **/*.ts, below the working directory.",
    parameters: {
      pattern: { type: "string", required: true, description: "Pattern matched against paths below the search directory." },
      path: { type: "string", description: "Directory to search, relative to the working directory; the whole tree by default." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    run: (args) => globFiles(args, workspace(args.cwd), settings),
  },
  {
    capability: "tool.grep",
    version: "1.0.0",
    description:
      "Search file contents with a regular expression, below the working directory; each match comes back as the file " +
      "path, the line number and the matching line, grouped by file and ordered by path and line.",
    parameters: {
      pattern: { type: "string", required: true, description: "Regular expression matched against each line." },
      path: { type: "string", description: "Directory to search, relative to the working directory; the whole tree by default." },
      include: { type: "string", description: "Search only files whose path matches this glob, such as **/*.ts." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    run: (args) => grepFiles(args, workspace(args.cwd), settings),
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
    const capabilities = toolkit.provides.map((item) => item.capability);
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
      if (!matched.startsWith(wanted)) problems.push(`grep rendered ${JSON.stringify(matched)}`);
      if (!matched.includes("1 files skipped as binary")) problems.push(`grep skipped ${JSON.stringify(matched)}`);
      const single = grepFiles({ pattern: "beta" }, space, wide);
      if (!single.startsWith("notes.txt\n  Line 2: beta")) {
        problems.push(`a one match search rendered ${JSON.stringify(single)}`);
      }
      if (!grepFiles({ pattern: "alpha", include: "**/*.ts" }, space, wide).startsWith("src/code.ts")) {
        problems.push("include did not narrow the search to the TypeScript file");
      }
      if (!grepFiles({ pattern: "alpha", include: "*.ts" }, space, wide).startsWith("no matches for")) {
        problems.push("a bare include pattern matched below the root");
      }
      const under = grepFiles({ pattern: "alpha", path: "src" }, space, wide);
      if (!under.startsWith("src/code.ts") || under.includes("notes.txt")) {
        problems.push(`grep ignored the path argument: ${JSON.stringify(under)}`);
      }
      const budgeted = grepFiles({ pattern: "alpha", path: "src" }, space, { ...wide, max_matches: 1 });
      if (!budgeted.includes("max_matches of 1, so 1 more matches are not shown")) {
        problems.push(`a capped grep said ${JSON.stringify(budgeted)}`);
      }
      if (budgeted.split("\n").filter((line) => line.startsWith("  ")).length !== 1) {
        problems.push(`a capped grep showed ${JSON.stringify(budgeted)}`);
      }
      if (!grepFiles({ pattern: "alpha" }, space, { ...wide, max_line_chars: 5 }).includes("  Line 1: alpha…")) {
        problems.push("grep did not clip a long line");
      }
      const narrowed = grepFiles({ pattern: "alpha" }, space, { ...wide, max_file_bytes: 8 });
      if (!narrowed.startsWith("no matches for") || !narrowed.includes("3 files skipped as binary")) {
        problems.push(`a byte capped search rendered ${JSON.stringify(narrowed)}`);
      }
      if (!grepFiles({ pattern: "nothing here" }, space, wide).startsWith('no matches for "nothing here" below .')) {
        problems.push("an empty search did not say where it looked");
      }
      for (const [args, why] of [
        [{ pattern: "(" }, "pattern"],
        [{ pattern: "   " }, "pattern"],
        [{ pattern: "alpha", include: "**/*.ts,**/*.md" }, "comma list"],
        [{ pattern: "alpha", include: "!**/*.md" }, "negation"],
        [{ pattern: "alpha", include: 7 }, "non-string include"],
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
