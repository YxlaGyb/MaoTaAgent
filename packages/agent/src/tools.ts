// 模型看的工具表。一个来自 tools（能力槽 tool.*），
// 另一个是 loop 自己加的 skill —— 技能不是 shell 命令，不该混进工具插件里。
export interface ToolSpec {
  name: string;
  description?: string;
  input_schema?: unknown;
  capability?: string;
}

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