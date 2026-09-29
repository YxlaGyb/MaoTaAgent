import type { Channel } from "@maota/plugin-kit";

import { eventOf } from "./sources.ts";
import type { TurnEvent, TurnInput, TurnResult } from "./types.ts";

export interface RunEntry {
  id: string;
  input: TurnInput;
  emit(event: TurnEvent): void;
}

const CRON_TOOLS = ["cron_create", "cron_update", "cron_delete", "cron_run_now"];

function loopParams(input: TurnInput): Record<string, unknown> {
  const denied = new Set(input.tools_deny ?? []);
  if (input.source.kind === "schedule") for (const name of CRON_TOOLS) denied.add(name);
  return {
    session_id: input.session_id,
    cwd: input.cwd,
    input: input.input,
    source: input.source,
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.route === undefined ? {} : { route: input.route }),
    ...(input.max_steps === undefined ? {} : { max_steps: input.max_steps }),
    ...(denied.size === 0 ? {} : { tools_deny: [...denied] }),
  };
}

export async function executeTurn(channel: Channel, entry: RunEntry, signal: AbortSignal): Promise<TurnResult> {
  if (entry.input.permission !== undefined) {
    try {
      await channel.call(
        "permission",
        "set_policy",
        { session_id: entry.input.session_id, cwd: entry.input.cwd, mode: entry.input.permission },
        { signal, timeout_ms: 10_000 },
      );
    } catch {
      if (entry.input.permission === "ask") throw new Error("permission policy could not be set");
    }
  }
  const stream = await channel.stream("agent.loop", "run", loopParams(entry.input), { signal });
  let result: TurnResult | null = null;
  for await (const chunk of stream) {
    if (signal.aborted) {
      stream.cancel();
      throw new Error("turn cancelled");
    }
    const event = eventOf(chunk, entry.id, entry.input.session_id, entry.input.source);
    entry.emit(event);
    if (event.type === "done") {
      result = {
        turn_id: entry.id,
        session_id: entry.input.session_id,
        text: event.text ?? "",
        reason: event.reason ?? "completed",
        steps: event.steps ?? 0,
      };
    }
  }
  if (result === null) throw new Error("agent.loop ended without a done event");
  return result;
}
