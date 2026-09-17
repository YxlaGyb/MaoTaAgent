export interface SkillSummary {
  name: string;
  description: string;
}

export function systemPrompt(base: string, skills: readonly SkillSummary[], cwd?: string | null): string {
  const lines = base.trim() === "" ? [] : [base.trim()];
  if (typeof cwd === "string" && cwd !== "") lines.push("", `工作目录: ${cwd}`);
  if (skills.length > 0) {
    lines.push("", "Skills you can read with the `skill` tool (name: what it is for):");
    for (const skill of skills) lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return lines.join("\n");
}
