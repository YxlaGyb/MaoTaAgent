import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPlugin, type Definition } from "../../plugin-kit/src/index.ts";
import {
  defaultMaxPath,
  defaultRoot,
  encodeDir,
  list,
  load,
  remove,
  save,
  serially,
  sameCwd,
  type Limits,
} from "./store.ts";

const MIB = 1024 * 1024;

let settings: { root: string; limits: Limits } = {
  root: defaultRoot(),
  limits: { max_bytes: 50 * MIB, max_path: defaultMaxPath() },
};

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function keyOf(params: unknown): string {
  const input = (params ?? {}) as { id?: unknown; cwd?: unknown };
  return `session:${encodeDir(typeof input.cwd === "string" ? input.cwd : "")}:${String(input.id ?? "")}`;
}

export const definition: Definition = {
  provides: [{ capability: "session", version: "1.0.0" }],
  configKeys: ["dir", "max_bytes", "max_path"],

  setup(wiring) {
    const configured = wiring.config.dir;
    settings = {
      root: typeof configured === "string" && configured.trim() !== "" ? configured : defaultRoot(),
      limits: {
        max_bytes: positive(wiring.config.max_bytes, 50 * MIB),
        max_path: positive(wiring.config.max_path, defaultMaxPath()),
      },
    };
  },

  methods: {
    list() {
      return { dir: settings.root, sessions: list(settings.root) };
    },

    load(params) {
      return serially(keyOf(params), () => load(settings.root, params?.id, params?.cwd, settings.limits));
    },

    save(params) {
      return serially(keyOf(params), () =>
        save(
          settings.root,
          { id: params?.id, cwd: params?.cwd, title: params?.title, messages: params?.messages },
          settings.limits,
        ),
      );
    },

    delete(params) {
      return serially(keyOf(params), () => ({
        deleted: remove(settings.root, params?.id, params?.cwd, settings.limits),
      }));
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "session-check-"));
    const limits: Limits = { max_bytes: 4096, max_path: defaultMaxPath() };
    try {
      const cases: Array<[string, string]> = [
        ["", "default"],
        ["E:\\SystemShare\\Documents\\Cyrilux", "E--SystemShare-Documents-Cyrilux"],
        ["E:\\SystemShare\\Documents\\Cyrilux\\", "E--SystemShare-Documents-Cyrilux"],
        ["/home/x/proj", "-home-x-proj"],
        ["/home/x/proj/", "-home-x-proj"],
      ];
      for (const [cwd, want] of cases) {
        const got = encodeDir(cwd);
        if (got !== want) problems.push(`encodeDir(${JSON.stringify(cwd)}) = ${JSON.stringify(got)}, want ${want}`);
      }

      for (const bad of ["", "../x", ".hidden", "a/b", "x".repeat(65)]) {
        try {
          load(root, bad, "", limits);
          problems.push(`load accepted the bad id ${JSON.stringify(bad)}`);
        } catch {
        }
      }

      const fresh = load(root, "abc", "E:\\proj", limits);
      if (fresh.messages.length !== 0 || fresh.dangling) problems.push("load on a missing session is wrong");

      const messages = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      save(root, { id: "abc", cwd: "E:\\proj", title: "hi", messages }, limits);
      const back = load(root, "abc", "E:\\proj", limits);
      if (back.title !== "hi") problems.push(`title came back as ${JSON.stringify(back.title)}`);
      if (back.messages.length !== 2) problems.push(`messages came back as ${back.messages.length}`);
      if (back.dangling) problems.push("a finished turn was marked dangling");
      if (save(root, { id: "abc", cwd: "E:\\proj", messages: [...messages, { role: "user", content: "again" }] }, limits).title !== "hi") {
        problems.push("save dropped the existing title");
      }
      if (!load(root, "abc", "E:\\proj", limits).dangling) problems.push("a trailing user message was not marked dangling");

      if (!sameCwd("E:\\proj", "E:\\proj\\")) problems.push("a trailing separator looked like another cwd");
      save(root, { id: "abc", cwd: "E:\\proj\\", messages }, limits);
      try {
        save(root, { id: "abc", cwd: "E:/proj", messages }, limits);
        problems.push("save overwrote a session whose cwd encodes to the same folder");
      } catch {
      }

      try {
        save(root, { id: "big", cwd: "E:\\proj", messages: [{ role: "user", content: "x".repeat(5000) }] }, limits);
        problems.push("save accepted a session over max_bytes");
      } catch {
      }

      save(root, { id: "other", cwd: "E:\\other", messages }, limits);
      const listed = list(root);
      if (listed.length !== 2) problems.push(`list found ${listed.length} sessions, want 2`);
      const abc = listed.find((entry) => entry.id === "abc");
      if (abc?.cwd !== "E:\\proj") problems.push(`list reported cwd ${JSON.stringify(abc?.cwd)}`);
      if (!listed.some((entry) => entry.cwd === "E:\\other")) problems.push("list lost the second workdir");
      const strays = readdirSync(join(root, encodeDir("E:\\proj"))).filter((name) => name.endsWith(".tmp"));
      if (strays.length > 0) problems.push(`left temp files behind: ${strays.join(", ")}`);

      if (!remove(root, "abc", "E:\\proj", limits)) problems.push("delete said it did nothing");
      if (load(root, "abc", "E:\\proj", limits).messages.length !== 0) problems.push("delete left the session behind");
      try {
        remove(root, "abc", "E:\\proj", limits);
      } catch (error) {
        problems.push(`second delete threw: ${error instanceof Error ? error.message : String(error)}`);
      }

      await Promise.all(
        [1, 2, 3, 4].map((n) =>
          serially(`session:proj:race`, () =>
            save(root, { id: "race", cwd: "E:\\proj", messages: [{ role: "user", content: `n=${n}` }] }, limits),
          ),
        ),
      );
      const raced = load(root, "race", "E:\\proj", limits);
      if (raced.messages.length !== 1) problems.push(`concurrent saves left ${raced.messages.length} messages`);
      if (readdirSync(join(root, encodeDir("E:\\proj"))).some((name) => name.endsWith(".tmp"))) {
        problems.push("concurrent saves left a temp file behind");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
