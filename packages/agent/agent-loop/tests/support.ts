/// The helpers the loop smoke cases share: shaping assistant replies that name
/// tool calls, recording the events a run emits, and turning those events into
/// the terse trace the cases assert against.

import { batchesOf, type Disposition, type LoopEvent, type Message } from "../src/index.ts";

export function batched(dispositions: readonly Disposition[], maxParallel: number): string[][] {
  return batchesOf(
    dispositions.map((_, index) => ({ id: `c${index}`, name: "t", args: {} })),
    dispositions,
    maxParallel,
  ).map((group) => group.map((call) => call.id));
}

export function recorder(): { events: LoopEvent[]; emit: (event: LoopEvent) => void } {
  const events: LoopEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

export function trace(events: readonly LoopEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "step") return [`step:${event.step}`];
    if (event.type === "tool_call") return [`call:${event.tool}@${event.id}`];
    if (event.type === "tool_result") return [`result:${event.tool}@${event.id}:${event.ok}`];
    return [];
  });
}

export function calls(...names: Array<[string, string]>): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: names.map(([id, name]) => ({ id, function: { name, arguments: "{}" } })),
  };
}

export const silent = () => {};
