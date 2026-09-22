import type { Route } from "@maota/plugin-kit";

export const TOOL_PREFIX = "tool.";

export interface ToolRoute {
  name: string;
  capability: string;
  plugin: string;
}

export function discover(capabilities: Record<string, Route>): Map<string, ToolRoute> {
  const tools = new Map<string, ToolRoute>();
  for (const [capability, route] of Object.entries(capabilities)) {
    if (!capability.startsWith(TOOL_PREFIX)) continue;
    const name = capability.slice(TOOL_PREFIX.length);
    if (name === "") continue;
    tools.set(name, { name, capability, plugin: route.plugin });
  }
  return tools;
}

export function sorted(tools: Map<string, ToolRoute>): ToolRoute[] {
  return [...tools.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
