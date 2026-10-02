import type { Route } from "@maota/plugin-kit";

const PREFIX = "model.adapter.";

let routes: Record<string, Route> = {};
let adapters = new Map<string, Route>();

export function adapterCapability(adapter: string): string {
  return `${PREFIX}${adapter}`;
}

export function adapterId(capability: string): string | null {
  if (!capability.startsWith(PREFIX)) return null;
  const id = capability.slice(PREFIX.length);
  return id === "" ? null : id;
}

export function setRoutes(capabilities: Record<string, Route>): void {
  routes = { ...capabilities };
  for (const [id, route] of adapters) {
    const capability = adapterCapability(id);
    if (routes[capability]?.plugin !== route.plugin) adapters.delete(id);
  }
}

export function addAdapter(capability: string, plugin: string): void {
  const id = adapterId(capability);
  if (id === null) throw new Error(`not an adapter capability: ${capability}`);
  adapters.set(id, { plugin });
}

export function removeAdapter(capability: string, plugin: string): boolean {
  const id = adapterId(capability);
  if (id === null || adapters.get(id)?.plugin !== plugin) return false;
  return adapters.delete(id);
}

export function adapterRoute(adapter: string): Route | undefined {
  return adapters.get(adapter);
}

export function adapterEntries(): Array<[string, string]> {
  return [...adapters.entries()]
    .map(([id, route]) => [id, adapterCapability(id), route.plugin] as [string, string, string])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, capability]) => [id, capability]);
}
