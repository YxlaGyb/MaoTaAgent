#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspace } from "@maota/fs";
import { defineTools, runPlugin, type Definition } from "@maota/plugin-kit";

import { globFiles, patternToRegExp } from "./glob.ts";

const DEFAULTS = {
  max_glob_results: 200,
  follow_links: false,
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
]);

export const definition: Definition = {
  provides: toolkit.provides,
  configKeys: ["max_glob_results", "follow_links"],

  setup(wiring) {
    settings = {
      max_glob_results: positive(wiring.config.max_glob_results, DEFAULTS.max_glob_results),
      follow_links: wiring.config.follow_links === true,
    };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const capabilities = toolkit.provides.map((item) => item.capability);
    if (capabilities.join(",") !== "tool.glob") problems.push(`the toolkit provides ${capabilities.join(", ")}`);
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
      const found = globFiles({ pattern: "**/*.ts" }, space, { max_glob_results: 10, follow_links: false });
      if (found.count !== 1 || found.files[0] !== "src/a.ts") problems.push(`glob reported ${JSON.stringify(found)}`);
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);