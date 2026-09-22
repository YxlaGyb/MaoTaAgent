import type { ToolSpec } from "@maota/agent-loop";

export const SKILL_TOOL: ToolSpec = {
  name: "skill",
  description: "Read the full text of a skill by name.",
  input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
};

export interface HostValues {
  session_cwd: string | null;
  session_id: string | null;
  call_id: string | null;
  subagent: SubagentIdentity | null;
}

/// Which subagent a call belongs to, as the tool that asks for approval needs
/// to say it: the id of its own session, the type it was started as and the
/// label its delegating call carried.
export interface SubagentIdentity {
  id: string;
  type: string;
  description: string;
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
    const value = hostValue(entry.source, host);
    if (value === null || value === "") continue;
    if (filled(out[entry.name])) continue;
    out = { ...out, [entry.name]: value };
  }
  return out;
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value !== "";
}

/// Only the sources a tool declares are filled, and an unknown source stays
/// empty rather than reaching for a value the declaration never asked for.
export function hostValue(source: string, host: HostValues): string | SubagentIdentity | null {
  if (source === "session_cwd") return host.session_cwd;
  if (source === "session_id") return host.session_id;
  if (source === "call_id") return host.call_id;
  if (source === "subagent") return host.subagent;
  return null;
}
