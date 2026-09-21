import type { Channel, Route } from "@maota/plugin-kit";
import {
  hookLabel,
  isHookCapability,
  isHookEvent,
  mergeHookOutcomes,
  type HookContribution,
  type HookDescription,
  type HookEvent,
  type HookOutcome,
  type HookReply,
} from "@maota/hook-protocol";

export interface HookProvider {
  capability: string;
  events: HookEvent[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function providerCapabilities(capabilities: Record<string, Route>): string[] {
  return Object.keys(capabilities).filter(isHookCapability).sort();
}

/// Ask every `hook.*` capability which events it implements. A capability that
/// cannot answer, or that declares nothing this engine knows, is skipped with a
/// warning rather than taken as a hook: the capability table is the only
/// registry there is, so a malformed entry must not stop the others.
export async function describeProviders(
  channel: Channel,
  capabilities: Record<string, Route>,
  signal: AbortSignal,
): Promise<HookProvider[]> {
  const found: HookProvider[] = [];
  for (const capability of providerCapabilities(capabilities)) {
    try {
      const reply = (await channel.call(capability, "describe", {}, { signal })) as HookDescription | null;
      const events = Array.isArray(reply?.events) ? reply.events.filter(isHookEvent) : [];
      if (events.length === 0) {
        channel.log("warn", `${capability} declares no hook event; skipped`, { capability });
        continue;
      }
      found.push({ capability, events });
    } catch (error) {
      channel.log("warn", `${capability} has no usable describe; skipped`, { capability, error: messageOf(error) });
    }
  }
  return found;
}

/// Ask the hooks that declared `event` for their opinion, in capability order,
/// and fold the answers. A hook that throws or times out contributes nothing:
/// it is an extra layer over a gate that already fails closed, so its absence
/// must never become the reason the run stops.
export async function runHooks(
  channel: Channel,
  signal: AbortSignal,
  event: HookEvent,
  payload: unknown,
  maxContextChars: number,
  providers: readonly HookProvider[],
): Promise<HookOutcome> {
  const contributions: HookContribution[] = [];
  for (const provider of providers) {
    if (!provider.events.includes(event)) continue;
    try {
      const reply = (await channel.call(provider.capability, event, payload, { signal })) as HookReply | null;
      if (reply !== null && reply !== undefined) {
        contributions.push({ source: hookLabel(provider.capability), reply });
      }
    } catch (error) {
      channel.log("warn", `${provider.capability} failed on ${event}`, { error: messageOf(error) });
    }
  }
  const outcome = mergeHookOutcomes(contributions, event, maxContextChars);
  channel.log("info", `${event}: ${outcome.decision ?? "no opinion"}`, {
    event,
    answered: contributions.map((contribution) => contribution.source),
  });
  return outcome;
}
