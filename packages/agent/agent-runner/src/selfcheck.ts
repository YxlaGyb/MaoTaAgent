import { TurnQueue } from "./queue.ts";
import { asSource, eventOf, scheduleNotice } from "./sources.ts";
import type { TurnEvent, TurnResult } from "./types.ts";

export async function runSelfCheck(): Promise<string[]> {
  const problems: string[] = [];
  if (asSource({ kind: "job" })?.kind !== "job") problems.push("job source was refused");
  if (asSource({ kind: "unknown" }) !== null) problems.push("an unknown source was accepted");
  if (!scheduleNotice({ id: "s1", occurrence: "2099-01-01T00:00:00Z", prompt: "x" }).includes("SCHEDULE REMINDER")) {
    problems.push("schedule notice lost its marker");
  }
  const event = eventOf({ type: "done", text: "ok", reason: "completed", steps: 1 }, "t1", "s1", { kind: "user" });
  if (event.type !== "done" || event.text !== "ok" || event.steps !== 1) problems.push("event projection drifted");

  const order: string[] = [];
  const queue = new TurnQueue(
    { maxParallel: 1, maxSystem: 1, wakeBudget: 0 },
    async (entry, signal): Promise<TurnResult> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (signal.aborted) throw new Error("cancelled");
      order.push(entry.input.input);
      return { turn_id: entry.id, session_id: entry.input.session_id, text: entry.input.input, reason: "completed", steps: 1 };
    },
  );
  const emit = (_event: TurnEvent): void => {};
  const first = queue.submit({ session_id: "s", cwd: "", input: "system", source: { kind: "job" } }, true, emit);
  const user = queue.submit({ session_id: "s", cwd: "", input: "user", source: { kind: "user" } }, true, emit);
  await Promise.all([first.done, user.done]);
  if (order.join(",") !== "user,system") problems.push(`queue order was ${order.join(",")}`);
  return problems;
}