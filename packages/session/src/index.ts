import { runPlugin, type Definition } from "@maota/plugin-kit";
import {
  appendEvent,
  appendTodos,
  childrenOf,
  DEFAULT_MAX_EVENTS,
  defaultMaxPath,
  defaultRoot,
  encodeDir,
  eventsOf,
  list,
  load,
  remove,
  save,
  serially,
  setWarner,
  todosOf,
  type Limits,
} from "./store.ts";
import { retryEventOf } from "./plan.ts";
import { runSelfCheck } from "./selfcheck.ts";

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
      return serially(keyOf(params), () =>
        eventsOf(settings.root, params?.id, params?.cwd, settings.limits),
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

    append_event(params) {
      return serially(keyOf(params), () =>
        appendEvent(
          settings.root,
          { id: params?.id, cwd: params?.cwd, event: retryEventOf(params?.event) },
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
  selfCheck() {
    return runSelfCheck();
  },
};

runPlugin(definition);
