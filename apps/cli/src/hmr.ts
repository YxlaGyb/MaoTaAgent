import { resolve } from "node:path";

import type { Event, Host } from "../../../packages/boot/host/src/index.ts";
import { moduleGraph } from "./graph.ts";

const RESTART_DEBOUNCE_MS = 150;
const ENTRY = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

function entryOf(payload: Record<string, unknown>): { plugin: string; entry: string } | null {
  const plugin = typeof payload.plugin === "string" ? payload.plugin : "";
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const args = Array.isArray(payload.args) ? payload.args : [];
  const entry = args.find((arg): arg is string => typeof arg === "string" && ENTRY.test(arg));
  if (plugin === "" || entry === undefined) return null;
  return { plugin, entry: resolve(cwd, entry) };
}

export function restartOnSourceChange(kernel: Host): void {
  const owners = new Map<string, Set<string>>();
  const queued = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  function forget(plugin: string): void {
    for (const [file, set] of owners) {
      set.delete(plugin);
      if (set.size === 0) owners.delete(file);
    }
  }

  function remember(event: Event): void {
    const found = entryOf((event.payload ?? {}) as Record<string, unknown>);
    if (found === null) return;
    forget(found.plugin);
    for (const file of moduleGraph(found.entry)) {
      const key = file.toLowerCase();
      const set = owners.get(key) ?? new Set<string>();
      set.add(found.plugin);
      owners.set(key, set);
    }
  }

  function fire(): void {
    timer = null;
    const ids = [...queued];
    queued.clear();
    for (const id of ids) {
      kernel.restart(id, "source").catch((error: unknown) => {
        console.error(`MaoTa: restart ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  kernel.on(["kernel.plugin.started"], remember);
  kernel.on(["kernel.plugin.stopped"], (event) => {
    const plugin = ((event.payload ?? {}) as { plugin?: unknown }).plugin;
    if (typeof plugin === "string") forget(plugin);
  });
  kernel.on(["dev.source.changed"], (event) => {
    const changed = ((event.payload ?? {}) as { path?: unknown }).path;
    if (typeof changed !== "string") return;
    for (const id of owners.get(resolve(changed).toLowerCase()) ?? []) queued.add(id);
    if (queued.size === 0) return;
    if (timer === null) timer = setTimeout(fire, RESTART_DEBOUNCE_MS);
  });
}