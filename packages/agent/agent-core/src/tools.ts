import type { ToolSpec } from "@maota/agent-loop";

export const SKILL_TOOL: ToolSpec = {
  name: "skill",
  description: "Read the full text of a skill by name.",
  input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
};

export function readToolList(reply: unknown): ToolSpec[] {
  const tools = (reply as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    const spec = tool as ToolSpec | undefined;
    return typeof spec?.name === "string" && spec.name !== "" ? [spec] : [];
  });
}

export function injectCwd(spec: ToolSpec | undefined, args: unknown, cwd: string | null): unknown {
  if (cwd === null || spec === undefined) return args;
  const schema = spec.input_schema as { properties?: Record<string, unknown> } | undefined;
  if (!schema?.properties || !("cwd" in schema.properties)) return args;
  if (args === null || typeof args !== "object") return args;
  const input = args as Record<string, unknown>;
  if (typeof input.cwd === "string" && input.cwd !== "") return input;
  return { ...input, cwd };
}
