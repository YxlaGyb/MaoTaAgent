import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPlugin, type Definition } from "@maota/plugin-kit";
import {
  appendTodos,
  childrenOf,
  DEFAULT_MAX_EVENTS,
  defaultMaxPath,
  defaultRoot,
  encodeDir,
  list,
  load,
  messageSource,
  remove,
  save,
  SCHEMA_VERSION,
  serially,
  setWarner,
  sameCwd,
  todosOf,
  write,
  type Limits,
} from "./store.ts";
import { MAX_TODO_CONTENT_CHARS, MAX_TODO_ITEMS, viewOf, type SessionEvent, type TodoItem } from "./plan.ts";

const MIB = 1024 * 1024;

let settings: { root: string; limits: Limits } = {
  root: defaultRoot(),
  limits: { max_bytes: 50 * MIB, max_path: defaultMaxPath(), max_events: DEFAULT_MAX_EVENTS },
};

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function keyOf(params: unknown): string {
  const input = (params ?? {}) as { id?: unknown; cwd?: unknown };
  return `session:${encodeDir(typeof input.cwd === "string" ? input.cwd : "")}:${String(input.id ?? "")}`;
}

export const definition: Definition = {
  provides: ["session"],
  configKeys: ["dir", "max_bytes", "max_path", "max_events"],

  setup(wiring) {
    const configured = wiring.config.dir;
    settings = {
      root: typeof configured === "string" && configured.trim() !== "" ? configured : defaultRoot(),
      limits: {
        max_bytes: positive(wiring.config.max_bytes, 50 * MIB),
        max_path: positive(wiring.config.max_path, defaultMaxPath()),
        max_events: positive(wiring.config.max_events, DEFAULT_MAX_EVENTS),
      },
    };
  },

  start(wiring) {
    setWarner((message, data) => wiring.channel.log("warn", message, data));
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

    events(params) {
      return serially(keyOf(params), () => {
        const found = load(settings.root, params?.id, params?.cwd, settings.limits);
        return { events: found.events, todos: viewOf(found.events) };
      });
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
    const limits: Limits = { max_bytes: 4096, max_path: defaultMaxPath(), max_events: DEFAULT_MAX_EVENTS };
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
      for (const version of [1, 2, 3]) {
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

      const note = {
        role: "user",
        name: "skill-catalog",
        content: "<available_skills>",
        source: { kind: "skill-catalog", entries: [{ name: "code-review", description: "about it" }] },
      };
      save(root, { id: "note", cwd: "E:\\proj", title: "note", messages: [note] }, limits);
      const reread = load(root, "note", "E:\\proj", limits);
      if (messageSource(reread.messages[0]?.source)?.entries[0]?.name !== "code-review") {
        problems.push(`a catalog note came back as ${JSON.stringify(reread.messages[0]?.source)}`);
      }
      if (reread.schema_version !== SCHEMA_VERSION) problems.push("a catalog note wrote the wrong schema");
      save(
        root,
        {
          id: "note",
          cwd: "E:\\proj",
          title: "note",
          messages: [
            {
              ...note,
              source: { kind: "skill-catalog", update: true, entries: [{ name: "code-review", description: "changed" }] },
            },
          ],
        },
        limits,
      );
      const noted = load(root, "note", "E:\\proj", limits);
      if (noted.messages[0]?.source?.update !== true) problems.push("the update flag was lost");
      if (messageSource({ kind: "other", entries: [] }) !== null) problems.push("messageSource accepted a foreign kind");
      if (messageSource({ kind: "skill-catalog", entries: [{ name: 1, description: "x" }] }) !== null) {
        problems.push("messageSource accepted a malformed entry");
      }
      if (messageSource({ kind: "skill-catalog", update: "yes", entries: [] }) !== null) {
        problems.push("messageSource accepted a malformed update flag");
      }
      try {
        save(root, { id: "torn", cwd: "E:\\proj", messages: [{ role: "user", source: { kind: "nope" } }] }, limits);
        problems.push("save accepted a source this build does not know");
      } catch (error) {
        if ((error as { code?: number }).code !== -32602) {
          problems.push("save refused an unreadable source with the wrong code");
        }
      }
      writeFileSync(
        join(root, encodeDir("E:\\proj"), "torn.json"),
        JSON.stringify({
          schema_version: 3,
          id: "torn",
          cwd: "E:\\proj",
          title: "torn",
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
          messages: [{ role: "user", content: "hi", source: { kind: "nope" } }, { role: "user", content: "kept" }],
          dangling: false,
        }),
      );
      const torn = load(root, "torn", "E:\\proj", limits);
      if (torn.messages.length !== 2) problems.push(`a torn note lost a message: ${torn.messages.length}`);
      if (torn.messages[0]?.source !== undefined) problems.push("a torn note kept a source this build cannot read");

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
      const visible = list(root);
      const visibleIds = visible.map((entry) => entry.id);
      if (!visibleIds.includes("abc-parent")) problems.push(`list hid the parent: ${visibleIds.join(",")}`);
      const listedChild = visible.find((entry) => entry.id === "child-a");
      if (listedChild?.parent?.id !== "abc-parent") {
        problems.push(`a listed child lost its link: ${JSON.stringify(listedChild?.parent)}`);
      }
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

      // A lock left behind by a process that is gone is taken over rather than
      // waited on, and the write that took it over cleans up after itself.
      const stranded = join(root, encodeDir("E:\\proj"), "abc.json.lock");
      writeFileSync(stranded, "999999\n" + Date.now());
      save(root, { id: "abc", cwd: "E:\\proj", messages }, limits);
      if (existsSync(stranded)) problems.push("a write left its lock file behind");

      const events: SessionEvent[] = Array.from({ length: 8 }, (_unused, index) => ({
        kind: "todos.write",
        at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        todos: [{ content: `step ${index}`, status: "pending" }],
      }));
      const tight: Limits = { ...limits, max_events: 5 };
      const foldedFile = write(
        root,
        "folded",
        "E:\\proj",
        { ...load(root, "folded", "E:\\proj", tight), events },
        tight,
      );
      if (foldedFile.events.length !== 5) problems.push(`folding kept ${foldedFile.events.length} events`);
      if (foldedFile.events[0]?.kind !== "todos.snapshot") problems.push("folding did not leave a snapshot first");
      const projected = viewOf(foldedFile.events);
      if (projected.todos[0]?.content !== "step 7") {
        problems.push(`folding lost the last plan: ${JSON.stringify(projected.todos)}`);
      }
      if (load(root, "folded", "E:\\proj", tight).events.length !== 5) {
        problems.push("the folded document did not keep the folded event list");
      }

      // The listing rides an index the writers keep current, and a document
      // written past that index, or under a directory of its own, is still
      // found because a missing index is rebuilt from the documents.
      const indexFile = join(root, "index.json");
      if (!existsSync(indexFile)) problems.push("no index was written");
      const indexed = JSON.parse(readFileSync(indexFile, "utf8")) as { sessions: Array<{ id: string }> };
      if (!indexed.sessions.some((entry) => entry.id === "abc")) problems.push("the index lost a session it wrote");
      mkdirSync(join(root, "nested"), { recursive: true });
      writeFileSync(
        join(root, "nested", "deep.json"),
        readFileSync(join(root, encodeDir("E:\\proj"), "abc.json"), "utf8").replace('"id":"abc"', '"id":"deep"'),
      );
      rmSync(indexFile);
      const rebuilt = list(root).map((entry) => entry.id);
      if (!rebuilt.includes("abc")) problems.push(`a rebuilt index lost abc: ${rebuilt.join(",")}`);
      if (!rebuilt.includes("deep")) problems.push(`a rebuilt index missed a nested document: ${rebuilt.join(",")}`);
      if (!existsSync(indexFile)) problems.push("a rebuilt index was not written back");

      const ruined = join(root, encodeDir("E:\\proj"), "ruined.json");
      writeFileSync(ruined, "{ not json");
      if (load(root, "ruined", "E:\\proj", limits).messages.length !== 0) {
        problems.push("a corrupt document did not read as an empty session");
      }
      if (existsSync(ruined)) problems.push("a corrupt document was left where the next save would overwrite it");
      const aside = readdirSync(join(root, encodeDir("E:\\proj"))).filter((name) =>
        name.startsWith("ruined.json.bad-"),
      );
      if (aside.length !== 1) problems.push(`a corrupt document was not set aside: ${aside.join(",")}`);

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
