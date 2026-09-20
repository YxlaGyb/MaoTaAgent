#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { workspace, type Workspace } from "@maota/fs";
import { defineTools, runPlugin, type Call, type Definition } from "@maota/plugin-kit";

import { editFile } from "./edit.ts";
import { readFile } from "./read.ts";
import { writeFile } from "./write.ts";

const DEFAULTS = {
  max_read_bytes: 256 * 1024,
  max_write_bytes: 1024 * 1024,
};

function defaultSpillDir(): string {
  const home = process.env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "tmp", "tool-results");
}

let settings = { ...DEFAULTS, spill_dir: defaultSpillDir() };

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function spaceOf(args: Record<string, unknown>): Workspace {
  return workspace(args.cwd, settings.spill_dir);
}

const toolkit = defineTools([
  {
    capability: "tool.read",
    version: "1.0.0",
    description: "Read a UTF-8 text file with line numbers; use offset and limit on a long file.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "File to read, relative to the working directory or absolute inside it.",
      },
      offset: { type: "integer", description: "First line to read, counting from 1." },
      limit: { type: "integer", description: "How many lines to read, 2000 by default." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    maxResultChars: null,
    run: (args) => readFile(args, spaceOf(args), { max_read_bytes: settings.max_read_bytes }),
  },
  {
    capability: "tool.write",
    version: "1.0.0",
    description: "Write a whole UTF-8 text file, creating the parent directories.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "File to write, inside the working directory.",
      },
      content: { type: "string", required: true, description: "The complete file content." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "never",
    run: (args) => writeFile(args, spaceOf(args), { max_write_bytes: settings.max_write_bytes }),
  },
  {
    capability: "tool.edit",
    version: "1.0.0",
    description: "Edit one UTF-8 text file by replacing literal text once, or everywhere with replace_all.",
    parameters: {
      file_path: { type: "string", required: true, description: "File to edit, inside the working directory." },
      old_string: {
        type: "string",
        required: true,
        description: "Literal text to replace; it must appear exactly once unless replace_all is true.",
      },
      new_string: { type: "string", required: true, description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "never",
    run: (args) =>
      editFile(args, spaceOf(args), {
        max_read_bytes: settings.max_read_bytes,
        max_write_bytes: settings.max_write_bytes,
      }),
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  configKeys: ["max_read_bytes", "max_write_bytes", "spill_dir"],

  setup(wiring) {
    settings = {
      max_read_bytes: positive(wiring.config.max_read_bytes, DEFAULTS.max_read_bytes),
      max_write_bytes: positive(wiring.config.max_write_bytes, DEFAULTS.max_write_bytes),
      spill_dir:
        typeof wiring.config.spill_dir === "string" && wiring.config.spill_dir.trim() !== ""
          ? wiring.config.spill_dir
          : defaultSpillDir(),
    };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const capabilities = toolkit.provides.map((item) => item.capability);
    if (capabilities.join(",") !== "tool.read,tool.write,tool.edit") {
      problems.push(`the toolkit provides ${capabilities.join(", ")}`);
    }
    const described = toolkit.methods.describe({}, { capability: "tool.read" } as unknown as Call) as {
      input_schema?: { properties?: Record<string, unknown> };
      host_args?: unknown[];
    };
    if (Object.hasOwn(described.input_schema?.properties ?? {}, "cwd")) {
      problems.push("the read spec exposes the host working directory");
    }
    if (described.host_args?.length !== 1) problems.push("the read spec does not declare its host argument");
    const noCwd = await (async () => {
      try {
        await toolkit.methods.run({ file_path: "a.txt" }, { capability: "tool.read" } as unknown as Call);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    if (noCwd !== "invalid arguments: arguments.cwd is required") {
      problems.push(`run without a session directory said ${JSON.stringify(noCwd)}`);
    }

    const dir = mkdtempSync(join(tmpdir(), "maota-tool-fs-"));
    try {
      const space = workspace(dir, join(dir, "spill"));
      const written = writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, {
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (!written.created || written.bytes !== 14) problems.push(`write reported ${JSON.stringify(written)}`);
      const read = readFile({ file_path: "a/b.txt" }, space, { max_read_bytes: DEFAULTS.max_read_bytes });
      if (!read.startsWith("1| one\n2| two\n3| three")) problems.push(`read returned ${JSON.stringify(read)}`);
      const edited = editFile({ file_path: "a/b.txt", old_string: "two", new_string: "TWO" }, space, {
        max_read_bytes: DEFAULTS.max_read_bytes,
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (edited.replaced !== 1) problems.push(`edit reported ${JSON.stringify(edited)}`);
      for (const file_path of ["../escape.txt", join(dir, "..", "escape.txt"), "a/b.txt:stream", "a/b."]) {
        try {
          writeFile({ file_path, content: "x" }, space, { max_write_bytes: DEFAULTS.max_write_bytes });
          problems.push(`write accepted ${JSON.stringify(file_path)}`);
        } catch {
        }
      }
      try {
        workspace(join(dir, "missing"), join(dir, "spill"));
        problems.push("workspace accepted a missing directory");
      } catch {
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);