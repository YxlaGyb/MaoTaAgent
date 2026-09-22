import { CallError, type Channel, type Route } from "@maota/plugin-kit";
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
  strict = true,
): Promise<HookProvider[]> {
  const found: HookProvider[] = [];
  for (const capability of providerCapabilities(capabilities)) {
    let events: HookEvent[] = [];
    try {
      const reply = (await channel.call(capability, "describe", {}, { signal })) as HookDescription | null;
      events = Array.isArray(reply?.events) ? reply.events.filter(isHookEvent) : [];
    } catch (error) {
      if (strict) throw new CallError(-32603, `${capability} has no usable describe: ${messageOf(error)}`);
      channel.log("warn", `${capability} has no usable describe; skipped`, { capability, error: messageOf(error) });
      continue;
    }
    if (events.length === 0) {
      if (strict) throw new CallError(-32603, `${capability} declares no hook event this engine knows`);
      channel.log("warn", `${capability} declares no hook event; skipped`, { capability });
      continue;
    }
    found.push({ capability, events });
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
  parallel = true,
): Promise<HookOutcome> {
  const contributions = await collectHookContributions(channel, signal, event, payload, providers, parallel);
  const outcome = mergeHookOutcomes(contributions, event, maxContextChars);
  channel.log("info", `${event}: ${outcome.decision ?? "no opinion"}`, {
    event,
    answered: contributions.map((contribution) => contribution.source),
  });
  return outcome;
}

/// The same gathering without the fold, so a caller that also has command hooks
/// can fold every opinion about one event together instead of folding twice.
export async function collectHookContributions(
  channel: Channel,
  signal: AbortSignal,
  event: HookEvent,
  payload: unknown,
  providers: readonly HookProvider[],
  parallel = true,
): Promise<HookContribution[]> {
  const ask = async (provider: HookProvider): Promise<HookContribution | null> => {
    try {
      const reply = (await channel.call(provider.capability, event, payload, { signal })) as HookReply | null;
      return reply === null || reply === undefined ? null : { source: hookLabel(provider.capability), reply };
    } catch (error) {
      channel.log("warn", `${provider.capability} failed on ${event}`, { error: messageOf(error) });
      return null;
    }
  };
  const listening = providers.filter((provider) => provider.events.includes(event));
  const answers: Array<HookContribution | null> = [];
  if (parallel) {
    answers.push(...(await Promise.all(listening.map(ask))));
  } else {
    for (const provider of listening) answers.push(await ask(provider));
  }
  return answers.filter((answer): answer is HookContribution => answer !== null);
}
