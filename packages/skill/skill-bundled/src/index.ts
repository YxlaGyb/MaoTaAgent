#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CallError, packageVersion, runPlugin, type Definition } from "@maota/plugin-kit";
import { parseFrontmatter, scanSkillRoot, type SkillCandidate } from "@maota/skill";

/// The shipped skills rank below every local root, so a project that ships its
/// own `code-review` replaces the built-in one instead of colliding with it.
const BUNDLED_RANK = 600;

function skillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

const VERSION = packageVersion(import.meta.url);

export const definition: Definition = {
  provides: [{ capability: "skill.bundled", version: VERSION }],
  configKeys: [],

  methods: {
    list(_params, ctx) {
      const scanned = scanSkillRoot({ dir: skillsDir(), rank: BUNDLED_RANK, source: "bundled" });
      for (const note of scanned.notes) ctx.channel.log("warn", `skill-bundled: ${note}`);
      return { candidates: scanned.candidates };
    },

    load(params) {
      const locator = params?.locator as { path?: unknown } | null | undefined;
      const path = locator?.path;
      if (typeof path !== "string" || path === "") {
        throw new CallError(-32602, "load needs the locator the list handed out");
      }
      return { content: parseFrontmatter(readFileSync(path, "utf8")).body };
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const ctx = { channel: { log: (): void => {} } } as never;
    const scanned = scanSkillRoot({ dir: skillsDir(), rank: BUNDLED_RANK, source: "bundled" });
    const names = scanned.candidates.map((candidate: SkillCandidate) => candidate.name);
    const wanted = ["code-review", "commit-and-pr", "debug-repro", "doc-pairs", "plugin-authoring", "skill-authoring"];
    if (names.join(",") !== wanted.join(",")) problems.push(`bundled skills are ${names.join(",") || "(none)"}`);
    for (const candidate of scanned.candidates) {
      if (candidate.description.trim() === "") problems.push(`${candidate.name} has no description`);
      if (candidate.rank !== BUNDLED_RANK) problems.push(`${candidate.name} ranked ${candidate.rank}`);
      if (candidate.source !== "bundled") problems.push(`${candidate.name} came from ${candidate.source}`);
      if (candidate.resourceBase?.kind !== "directory") problems.push(`${candidate.name} has no resource base`);
    }
    const conditional = scanned.candidates.find((candidate) => candidate.name === "plugin-authoring");
    if ((conditional?.paths ?? []).join(",") !== "packages/**") {
      problems.push(`plugin-authoring declares ${String(conditional?.paths)}`);
    }
    for (const note of scanned.notes) problems.push(note);
    const body = definition.methods["load"]?.(
      { locator: { path: join(skillsDir(), "code-review", "SKILL.md") } },
      ctx,
    ) as { content?: string };
    if (typeof body.content !== "string" || body.content.trim() === "") problems.push("load returned no body");
    return problems;
  },
};

runPlugin(definition);
