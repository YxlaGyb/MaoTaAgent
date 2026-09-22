#!/usr/bin/env node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { pendingFileLocks, workspace, type Workspace } from "@maota/fs";
import { defineTools, packageVersion, runPlugin, type Call, type Definition } from "@maota/plugin-kit";

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

const VERSION = packageVersion(import.meta.url);

const toolkit = defineTools([
  {
    capability: "tool.read",
    version: VERSION,
    description: "Read a UTF-8 text file with line numbers; use offset and limit on a long file.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "File to read, relative to the working directory or absolute inside it.",
      },
      offset: { type: "integer", description: "First line of the window to read, counting from 1." },
      limit: { type: "integer", description: "How many lines to read, 2000 by default." },
      from_byte: {
        type: "integer",
        description: "Start the window at this byte instead of the beginning; the line numbers stay the file's own.",
      },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    maxResultChars: null,
    paths: ["file_path"],
    run: (args) => readFile(args, spaceOf(args), { max_read_bytes: settings.max_read_bytes }),
  },
  {
    capability: "tool.write",
    version: VERSION,
    description: "Write a whole UTF-8 text file, creating the parent directories.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "File to write, inside the working directory.",
      },
      content: { type: "string", required: true, description: "The text to write, or to append." },
      mode: {
        type: "string",
        enum: ["replace", "append"],
        description: "replace writes the whole file, append adds the text to the end; replace by default.",
      },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "never",
    paths: ["file_path"],
    run: (args) => writeFile(args, spaceOf(args), { max_write_bytes: settings.max_write_bytes }),
  },
  {
    capability: "tool.edit",
    version: VERSION,
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
    paths: ["file_path"],
    run: (args) =>
      editFile(args, spaceOf(args), { max_write_bytes: settings.max_write_bytes }),
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
      const written = await writeFile({ file_path: "a/b.txt", content: "one\ntwo\nthree\n" }, space, {
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (!written.created || written.bytes !== 14) problems.push(`write reported ${JSON.stringify(written)}`);
      if (written.mode !== "replace") problems.push(`a plain write reported the mode ${written.mode}`);
      const read = readFile({ file_path: "a/b.txt" }, space, { max_read_bytes: DEFAULTS.max_read_bytes });
      if (!read.startsWith("1| one\n2| two\n3| three")) problems.push(`read returned ${JSON.stringify(read)}`);
      const edited = await editFile({ file_path: "a/b.txt", old_string: "two", new_string: "TWO" }, space, {
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (edited.replaced !== 1) problems.push(`edit reported ${JSON.stringify(edited)}`);

      // Appending adds to the end; a byte offset moves the window and leaves the
      // line numbers alone.
      const appended = await writeFile({ file_path: "a/b.txt", content: "four\n", mode: "append" }, space, {
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (appended.created || appended.mode !== "append") problems.push(`append reported ${JSON.stringify(appended)}`);
      const longer = readFile({ file_path: "a/b.txt" }, space, { max_read_bytes: DEFAULTS.max_read_bytes });
      if (!longer.startsWith("1| one\n2| TWO\n3| three\n4| four")) problems.push(`append left ${JSON.stringify(longer)}`);
      const tail = readFile(
        { file_path: "a/b.txt", from_byte: Buffer.byteLength("one\nTWO\n") },
        space,
        { max_read_bytes: DEFAULTS.max_read_bytes },
      );
      if (!tail.startsWith("3| three")) problems.push(`a byte offset read ${JSON.stringify(tail)}`);

      // A replacement that straddles a block boundary is still found, which is
      // what the carried tail is for.
      const boundary = 64 * 1024 - 6;
      const needle = "NEEDLEACROSS";
      writeFileSync(join(dir, "big.txt"), `${"x".repeat(boundary)}${needle}${"z".repeat(20)}`);
      const crossed = await editFile({ file_path: "big.txt", old_string: needle, new_string: "FOUND" }, space, {
        max_write_bytes: DEFAULTS.max_write_bytes,
      });
      if (crossed.replaced !== 1) problems.push(`a boundary edit replaced ${crossed.replaced} times`);
      const after = readFileSync(join(dir, "big.txt"), "utf8");
      if (!after.includes("FOUND") || after.includes(needle)) problems.push("a boundary edit left the text wrong");
      if (after.length !== boundary + "FOUND".length + 20) problems.push(`a boundary edit changed the length to ${after.length}`);
      if (readdirSync(join(dir)).some((name) => name.endsWith(".lock") || name.endsWith(".tmp"))) {
        problems.push("an edit left a lock or a temporary file behind");
      }
      if (pendingFileLocks() !== 0) problems.push(`${pendingFileLocks()} file locks stayed on the books`);

      for (const file_path of ["../escape.txt", join(dir, "..", "escape.txt"), "a/b.txt:stream", "a/b."]) {
        try {
          await writeFile({ file_path, content: "x" }, space, { max_write_bytes: DEFAULTS.max_write_bytes });
          problems.push(`write accepted ${JSON.stringify(file_path)}`);
        } catch {
        }
      }
      for (const mode of ["merge", 7]) {
        try {
          await writeFile({ file_path: "a/b.txt", content: "x", mode }, space, {
            max_write_bytes: DEFAULTS.max_write_bytes,
          });
          problems.push(`write accepted the mode ${JSON.stringify(mode)}`);
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
