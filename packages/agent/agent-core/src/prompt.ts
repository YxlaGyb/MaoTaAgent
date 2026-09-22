/// The approval policy is stated so the model knows what a refusal means: an
/// `ask` deployment that nobody can answer refuses every destructive command,
/// and the model has to stop retrying instead of hunting for a way around it.
export function approvalText(mode?: string | null): string | null {
  if (mode === "ask") {
    return (
      "approval: ask. A command pwsh flags as destructive waits for the user's decision, " +
      "and is refused when nobody can answer; a refusal is final, so do not retry it."
    );
  }
  if (mode === "auto") return "approval: auto. A command pwsh flags as destructive is approved without asking.";
  if (mode === "full") return "approval: full. Commands run without asking.";
  return null;
}

export function systemPrompt(
  base: string,
  cwd?: string | null,
  approval?: string | null,
): string {
  const lines = base.trim() === "" ? [] : [base.trim()];
  if (typeof cwd === "string" && cwd !== "") lines.push("", `working directory: ${cwd}`);
  const policy = approvalText(approval);
  if (policy !== null) lines.push("", policy);
  return lines.join("\n");
}
