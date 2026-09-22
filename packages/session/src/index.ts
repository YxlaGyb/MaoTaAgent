import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPlugin, type Definition } from "@maota/plugin-kit";
import {
  appendTodos,
  childrenOf,
  defaultMaxPath,
  defaultRoot,
  encodeDir,
  list,
  load,
  remove,
  save,
  SCHEMA_VERSION,
  serially,
  sameCwd,
  todosOf,
  type Limits,
} from "./store.ts";
import { MAX_TODO_CONTENT_CHARS, MAX_TODO_ITEMS, type TodoItem } from "./plan.ts";

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
  provides: [{ capability: "session", version: "1.2.0" }],
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
          {
            id: params?.id,
            cwd: params?.cwd,
            title: params?.title,
            messages: params?.messages,
            parent: params?.parent,
          },
          settings.limits,
        ),
      );
    },

    children(params) {
      return serially(keyOf(params), () => ({
        children: childrenOf(settings.root, params?.id, params?.cwd),
      }));
    },

    todos(params) {
      return serially(keyOf(params), () =>
        todosOf(settings.root, params?.id, params?.cwd, settings.limits),
      );
    },

    save_todos(params) {
      return serially(keyOf(params), () =>
        appendTodos(
          settings.root,
          { id: params?.id, cwd: params?.cwd, todos: params?.todos },
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
        ["E:\\work\\proj\\app", "E--work-proj-app"],
        ["E:\\work\\proj\\app\\", "E--work-proj-app"],
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

      const empty = todosOf(root, "plan", "E:\\proj", limits);
      if (empty.revision !== 0 || empty.updated_at !== null || empty.todos.length !== 0) {
        problems.push(`a session that never wrote a plan read as ${JSON.stringify(empty)}`);
      }
      if (empty.counts.pending !== 0 || empty.counts.in_progress !== 0 || empty.counts.completed !== 0) {
        problems.push(`an empty plan counted ${JSON.stringify(empty.counts)}`);
      }

      const first: TodoItem[] = [
        { content: "read the parser", status: "completed" },
        { content: "rename the callers", status: "in_progress" },
      ];
      const wrote = appendTodos(root, { id: "plan", cwd: "E:\\proj", todos: first }, limits, "2026-01-01T00:00:00.000Z");
      if (wrote.revision !== 1) problems.push(`the first write reported revision ${wrote.revision}`);
      if (wrote.todos.length !== 2 || wrote.todos[1]?.content !== "rename the callers") {
        problems.push(`the first write read back as ${JSON.stringify(wrote.todos)}`);
      }
      if (wrote.counts.completed !== 1 || wrote.counts.in_progress !== 1 || wrote.counts.pending !== 0) {
        problems.push(`the first write counted ${JSON.stringify(wrote.counts)}`);
      }

      const second = appendTodos(
        root,
        { id: "plan", cwd: "E:\\proj", todos: [{ content: "ship it", status: "pending" }] },
        limits,
        "2026-01-01T00:00:01.000Z",
      );
      if (second.revision !== 2 || second.todos.length !== 1) {
        problems.push(`the second write read back as ${JSON.stringify(second)}`);
      }
      if (second.updated_at !== "2026-01-01T00:00:01.000Z") {
        problems.push(`the second write stamped ${String(second.updated_at)}`);
      }
      const stored = load(root, "plan", "E:\\proj", limits);
      if (stored.schema_version !== SCHEMA_VERSION) {
        problems.push(`a written document says schema ${stored.schema_version}`);
      }
      if (stored.events.length !== 2) problems.push(`the document kept ${stored.events.length} events`);

      save(root, { id: "plan", cwd: "E:\\proj", title: "plan", messages }, limits);
      const afterSave = todosOf(root, "plan", "E:\\proj", limits);
      if (afterSave.revision !== 2 || afterSave.todos[0]?.content !== "ship it") {
        problems.push(`saving the messages dropped the plan: ${JSON.stringify(afterSave)}`);
      }

      const folder = join(root, encodeDir("E:\\proj"));
      const planPath = join(folder, "old.json");
      for (const version of [1, 2]) {
        writeFileSync(
          planPath,
          JSON.stringify({
            schema_version: version,
            id: "old",
            cwd: "E:\\proj",
            title: "old",
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2025-01-01T00:00:00.000Z",
            messages,
            dangling: false,
          }),
        );
        const migrated = load(root, "old", "E:\\proj", limits);
        if (migrated.schema_version !== SCHEMA_VERSION || migrated.events.length !== 0) {
          problems.push(
            `a version ${version} document read as ${JSON.stringify(migrated.schema_version)}/${migrated.events.length}`,
          );
        }
        if (migrated.parent !== null) problems.push(`a version ${version} document invented a parent`);
        if (todosOf(root, "old", "E:\\proj", limits).revision !== 0) {
          problems.push(`a version ${version} document invented a plan`);
        }
        save(root, { id: "old", cwd: "E:\\proj", messages }, limits);
        const upgraded = JSON.parse(readFileSync(planPath, "utf8")) as { schema_version?: number; events?: unknown };
        if (upgraded.schema_version !== SCHEMA_VERSION || !Array.isArray(upgraded.events)) {
          problems.push(`a migrated document wrote ${JSON.stringify(upgraded.schema_version)}/${typeof upgraded.events}`);
        }
      }

      const parent = { id: "abc-parent", cwd: "E:\\proj", call_id: "call_2", type: "explore", description: "find it" };
      save(root, { id: "child-a", cwd: "E:\\proj", title: "find it", messages, parent }, limits);
      save(root, { id: "child-b", cwd: "E:\\proj", title: "fix it", messages, parent }, limits);
      save(root, { id: "abc-parent", cwd: "E:\\proj", title: "parent", messages }, limits);
      const kids = childrenOf(root, "abc-parent", "E:\\proj");
      if (kids.map((child) => child.id).join(",") !== "child-a,child-b") {
        problems.push(`children came back as ${kids.map((child) => child.id).join(",")}`);
      }
      if (kids[0]?.parent?.call_id !== "call_2" || kids[0]?.parent?.type !== "explore") {
        problems.push(`a child lost its link: ${JSON.stringify(kids[0]?.parent)}`);
      }
      const visible = list(root).map((entry) => entry.id);
      if (visible.includes("child-a") || visible.includes("child-b")) {
        problems.push(`list showed a child session: ${visible.join(",")}`);
      }
      if (!visible.includes("abc-parent")) problems.push(`list hid the parent: ${visible.join(",")}`);
      if (childrenOf(root, "child-b", "E:\\proj").length !== 0) {
        problems.push("a child reported children of its own");
      }
      const relinked = save(root, { id: "child-a", cwd: "E:\\proj", messages }, limits);
      if (relinked.parent?.id !== "abc-parent") problems.push("re-saving a child dropped its link");
      try {
        save(root, { id: "child-c", cwd: "E:\\proj", messages, parent: { id: "not a session" } }, limits);
        problems.push("save accepted a malformed parent");
      } catch {
      }

      for (const bad of [
        [{ content: "ok", status: "done" }],
        [{ content: "", status: "pending" }],
        [{ content: "ok", status: "pending", activeForm: "doing it" }],
        [{ content: "ok" }],
        ["not an object"],
        Array.from({ length: MAX_TODO_ITEMS + 1 }, () => ({ content: "x", status: "pending" })),
        [{ content: "x".repeat(MAX_TODO_CONTENT_CHARS + 1), status: "pending" }],
      ]) {
        try {
          appendTodos(root, { id: "bad", cwd: "E:\\proj", todos: bad }, limits);
          problems.push(`a plan with ${JSON.stringify(bad).slice(0, 60)} was accepted`);
        } catch {
        }
      }
      try {
        appendTodos(root, { id: "bad", cwd: "E:\\proj", todos: [{ content: "ok", status: "done" }, { content: "ok" }] }, limits);
        problems.push("a plan with two broken items was accepted");
      } catch (error) {
        const violations = (error as { data?: { violations?: unknown } }).data?.violations;
        if (!Array.isArray(violations) || violations.length !== 2) {
          problems.push(`two broken items reported ${JSON.stringify(violations)}`);
        }
      }
      if (existsSync(join(root, encodeDir("E:\\proj"), "bad.json"))) {
        problems.push("a refused plan was written anyway");
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

      await Promise.all([
        serially("session:proj:plan-race", () =>
          save(root, { id: "plan-race", cwd: "E:\\proj", messages }, limits),
        ),
        serially("session:proj:plan-race", () =>
          appendTodos(root, { id: "plan-race", cwd: "E:\\proj", todos: first }, limits),
        ),
        serially("session:proj:plan-race", () =>
          appendTodos(root, { id: "plan-race", cwd: "E:\\proj", todos: second.todos }, limits),
        ),
      ]);
      const planRaced = load(root, "plan-race", "E:\\proj", limits);
      if (planRaced.messages.length !== 2) {
        problems.push(`a concurrent save lost its messages: ${planRaced.messages.length}`);
      }
      if (planRaced.events.length !== 2) {
        problems.push(`concurrent plan writes kept ${planRaced.events.length} events`);
      }
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
