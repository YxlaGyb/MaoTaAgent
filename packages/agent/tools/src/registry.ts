import type { Route } from "@maota/plugin-kit";

export const TOOL_PREFIX = "tool.";

export interface ToolRoute {
  name: string;
  capability: string;
  plugin: string;
}

export function nameOf(capability: string): string | null {
  if (!capability.startsWith(TOOL_PREFIX)) return null;
  const name = capability.slice(TOOL_PREFIX.length);
  return name === "" ? null : name;
}

export function add(
  tools: Map<string, ToolRoute>,
  capability: string,
  plugin: string,
): ToolRoute {
  const name = nameOf(capability);
  if (name === null) throw new Error(`not a tool capability: ${capability}`);
  const entry = { name, capability, plugin };
  tools.set(name, entry);
  return entry;
}

export function reconcile(
  tools: Map<string, ToolRoute>,
  capabilities: Record<string, Route>,
): void {
  for (const [name, tool] of tools) {
    if (capabilities[tool.capability]?.plugin !== tool.plugin) tools.delete(name);
  }
}

export function sorted(tools: Map<string, ToolRoute>): ToolRoute[] {
  return [...tools.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
