import { Admission } from "./admission.ts";
import { OutputRing } from "./ring.ts";

export function runSelfCheck(): string[] {
  const problems: string[] = [];
  const admission = new Admission({ per_owner: 1, total: 2 });
  admission.take("s");
  try {
    admission.take("s");
    problems.push("admission allowed a second job for one owner");
  } catch {}
  admission.take("t");
  try {
    admission.take("u");
    problems.push("admission allowed work above the global cap");
  } catch {}
  admission.release("s");
  admission.release("t");

  const ring = new OutputRing();
  ring.append("hello ", "stdout");
  ring.append("world", "stdout");
  const read = ring.read({ id: "j1", kind: "shell", label: "x", status: "running", created_at: "", started_at: "" });
  if (read.chunks.map((chunk) => chunk.text).join("") !== "hello world") problems.push("output ring lost chunks");
  if (read.lossy) problems.push("a fresh output ring reported loss");
  return problems;
}