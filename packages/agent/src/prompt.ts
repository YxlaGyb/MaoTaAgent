// 系统提示词。技能只给名字和描述，正文让模型自己用 skill 工具去读（渐进披露）——
// 一次把几十个 SKILL.md 灌进上下文，是最贵也最没用的那种省事。
export interface SkillSummary {
  name: string;
  description: string;
}

export function systemPrompt(base: string, skills: readonly SkillSummary[]): string {
  const lines = base.trim() === "" ? [] : [base.trim()];
  if (skills.length > 0) {
    lines.push("", "Skills you can read with the `skill` tool (name: what it is for):");
    for (const skill of skills) lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return lines.join("\n");
}