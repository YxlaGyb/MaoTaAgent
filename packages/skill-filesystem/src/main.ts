#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CallError, runPlugin, type Definition } from "../../plugin-kit/src/index.ts";
import { scanDirs, type SkillFile } from "./scan.ts";

const DEFAULTS = { dirs: ["skills"], max_bytes: 64 * 1024 };

let settings = { ...DEFAULTS };
let known = new Map<string, SkillFile>();

export const definition: Definition = {
  provides: [{ capability: "skill.filesystem", version: "1.0.0" }],
  configKeys: ["dirs", "max_bytes"],

  setup(wiring) {
    settings = {
      dirs: Array.isArray(wiring.config.dirs)
        ? wiring.config.dirs.filter((dir): dir is string => typeof dir === "string")
        : DEFAULTS.dirs,
      max_bytes:
        typeof wiring.config.max_bytes === "number" && wiring.config.max_bytes > 0
          ? wiring.config.max_bytes
          : DEFAULTS.max_bytes,
    };
    known = new Map(scanDirs(settings.dirs).map((skill) => [skill.name, skill]));
  },

  methods: {
    scan(params) {
      const dirs = Array.isArray(params?.dirs)
        ? params.dirs.filter((dir: unknown): dir is string => typeof dir === "string")
        : settings.dirs;
      const skills = scanDirs(dirs);
      known = new Map(skills.map((skill) => [skill.name, skill]));
      return {
        dirs,
        skills: skills.map((skill) => ({ name: skill.name, description: skill.description, path: skill.path })),
      };
    },

    read(params) {
      const name = String(params?.name ?? "");
      const skill = known.get(name);
      if (!skill) throw new CallError(-32602, `unknown skill: ${name}`);
      const size = statSync(skill.path).size;
      if (size > settings.max_bytes) {
        throw new CallError(-32602, `skill ${name} is ${size} bytes, over the ${settings.max_bytes} byte cap`);
      }
      return { name: skill.name, path: skill.path, content: readFileSync(skill.path, "utf8") };
    },
  },

  selfCheck() {
    const problems: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "skill-check-"));
    try {
      mkdirSync(join(dir, "hello"));
      writeFileSync(join(dir, "hello", "SKILL.md"), "---\nname: hello\ndescription: say hi\n---\n\nbody\n");
      const skills = scanDirs([dir]);
      if (skills.length !== 1) problems.push(`scan found ${skills.length} skills, expected 1`);
      const first = skills[0];
      if (first?.name !== "hello") problems.push(`scan read name ${JSON.stringify(first?.name)}`);
      if (first?.description !== "say hi") problems.push(`scan read description ${JSON.stringify(first?.description)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
