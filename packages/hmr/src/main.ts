import { existsSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";

import { runPlugin, type Channel, type Definition } from "../../plugin-kit/src/index.ts";

const DEFAULT_ROOTS = ["apps", "packages"];
const IGNORED = new Set(["node_modules", ".git", "dist", "target"]);
const DEBOUNCE_MS = 100;

let roots: string[] = [...DEFAULT_ROOTS];
let channel: Channel | null = null;
const watchers: FSWatcher[] = [];
const pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function rootsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ROOTS];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function ignored(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => IGNORED.has(segment));
}

function flush(): void {
  timer = null;
  const paths = [...pending];
  pending.clear();
  const target = channel;
  if (target === null) return;
  for (const path of paths) {
    target.publish("dev.source.changed", { path }).catch((error: unknown) => {
      target.log("warn", `cannot publish dev.source.changed for ${path}`, { error: String(error) });
    });
  }
}

export const definition: Definition = {
  provides: [{ capability: "dev.hmr", version: "0.1.0" }],
  configKeys: ["roots"],

  setup(wiring) {
    roots = rootsFrom(wiring.config.roots);
  },

  start(wiring) {
    channel = wiring.channel;
    for (const root of roots) {
      const absolute = resolve(root);
      if (!existsSync(absolute)) continue;
      const watcher = watch(absolute, { recursive: true }, (_event, filename) => {
        if (filename === null) return;
        const name = filename.toString();
        if (ignored(name)) return;
        pending.add(resolve(absolute, name));
        if (timer === null) timer = setTimeout(flush, DEBOUNCE_MS);
      });
      watchers.push(watcher);
    }
  },

  methods: {
    status() {
      return { roots, watching: watchers.length };
    },
  },

  close() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending.clear();
    for (const watcher of watchers.splice(0)) watcher.close();
    channel = null;
  },

  selfCheck() {
    const problems: string[] = [];
    if (roots.length === 0) problems.push("roots is empty: nothing would be watched");
    for (const root of roots) {
      if (!existsSync(resolve(root))) problems.push(`roots entry does not exist: ${root}`);
    }
    return problems;
  },
};

runPlugin(definition);