import type { ToolSpec } from "@maota/agent-loop";

export const SKILL_TOOL: ToolSpec = {
  name: "skill",
  description: "Read the full text of a skill by name.",
  input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
};

export interface HostValues {
  session_cwd: string | null;
}

export function readToolList(reply: unknown): ToolSpec[] {
  const tools = (reply as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    const spec = tool as ToolSpec | undefined;
    return typeof spec?.name === "string" && spec.name !== "" ? [spec] : [];
  });
}

export function stripHostArgs(spec: ToolSpec): ToolSpec {
  const { name, description, input_schema, capability } = spec;
  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(input_schema === undefined ? {} : { input_schema }),
    ...(capability === undefined ? {} : { capability }),
  };
}

export function injectHostArgs(spec: ToolSpec | undefined, args: unknown, host: HostValues): unknown {
  const declared = spec?.host_args;
  if (declared === undefined || declared.length === 0) return args;
  if (args === null || typeof args !== "object") return args;
  const input = args as Record<string, unknown>;
  let out = input;
  for (const entry of declared) {
    const value = entry.source === "session_cwd" ? host.session_cwd : null;
    if (value === null || value === "") continue;
    const current = out[entry.name];
    if (typeof current === "string" && current !== "") continue;
    out = { ...out, [entry.name]: value };
  }
  return out;
}