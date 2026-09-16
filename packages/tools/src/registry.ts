// 工具目录: 一个能力槽 tool.<name> 就是一个工具 <name>。
// 热重载会换掉整张路由表，所以 start 时抓一次快照 —— 别把"哪个插件"缓存太久。
import type { Route } from "../../plugin-kit/src/index.ts";

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