/// The seam between the hook engine and the loop: the capability flags a
/// deployment's start announces, the translation from the engine's outcomes to
/// the loop's own decision shapes, and the one place a question becomes an
/// approval request. A hook that answers, fails or is absent must never be the
/// reason a run stops, so every read here defaults to "no opinion" and the two
/// optional capabilities are read live rather than copied.

import type { Call, Wiring } from "@maota/plugin-kit";
import type { HookEvent, HookOutcome } from "@maota/hook-protocol";
import type { PostToolDecision, PreToolDecision, StopDecision } from "@maota/agent-loop";

let hooksAvailable = false;
let skillsAvailable = false;

export function hooksOn(): boolean {
  return hooksAvailable;
}

export function skillsOn(): boolean {
  return skillsAvailable;
}

/// The hook engine and the skill registry are optional by design: a deployment
/// without one simply has no hooks and no catalog, and asking a capability
/// nobody provides would keep this plugin from starting at all.
export function startCapabilities(wiring: Wiring): void {
  hooksAvailable = wiring.capabilities.hooks !== undefined;
  skillsAvailable = wiring.capabilities.skill !== undefined;
  wiring.channel.log("info", `agent: hooks ${hooksAvailable ? "on" : "off"}, skills ${skillsAvailable ? "on" : "off"}`, {
    hooks: hooksAvailable,
    skills: skillsAvailable,
  });
}

/// The label a post-tool refusal carries once it becomes context: the engine
/// folds the reasons of several hooks into one, so the message names the event
/// they answered rather than any single hook.
export const DENIED = "hook:PostToolUse";

/// The engine answers in the hook dialect while the loop consumes its own
/// decision shapes. This file is the only place that knows both, so every hook
/// field is mapped here and a field this seam has no use for is dropped rather
/// than handed on.
export function asPreTool(outcome: HookOutcome): PreToolDecision {
  // `ask` is not a decision this loop knows: it is settled against the
  // permission layer before it gets here, so only a verdict travels on.
  const decision = outcome.decision === "ask" ? undefined : outcome.decision;
  return {
    ...(decision === undefined ? {} : { decision }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    ...(outcome.args === undefined ? {} : { args: outcome.args }),
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
  };
}

/// A refusal after the fact is read as a request to stop as well, since this
/// seam has no other way to say no; its reason rides along as context, so the
/// model learns why the round ended.
export function asPostTool(outcome: HookOutcome): PostToolDecision {
  const context = [...(outcome.context ?? [])];
  if (outcome.decision === "deny" && outcome.reason !== undefined) context.push({ source: DENIED, text: outcome.reason });
  return {
    ...(context.length === 0 ? {} : { context }),
    ...(outcome.output === undefined ? {} : { output: outcome.output }),
    ...(outcome.preventContinuation === true || outcome.decision === "deny" ? { halt: true } : {}),
  };
}

export function asStop(outcome: HookOutcome): StopDecision {
  return {
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
    ...(outcome.steer === undefined ? {} : { steer: outcome.steer }),
  };
}

export function hasOpinion(outcome: HookOutcome): boolean {
  return (
    outcome.decision !== undefined ||
    outcome.reason !== undefined ||
    outcome.args !== undefined ||
    outcome.context !== undefined ||
    outcome.output !== undefined ||
    outcome.preventContinuation !== undefined ||
    outcome.steer !== undefined
  );
}

/// A deployment without the engine has no hooks, and one that cannot answer
/// loses only its opinion, never the turn: a hook sits over a gate that already
/// fails closed, so it must never become the reason a run stops.
export async function triggerHook(ctx: Call, event: HookEvent, payload: unknown): Promise<HookOutcome> {
  if (!hooksAvailable) return {};
  try {
    const reply = (await ctx.channel.call("hooks", "trigger", { event, payload }, { signal: ctx.signal })) as
      | HookOutcome
      | null;
    return reply ?? {};
  } catch (error) {
    ctx.channel.log("warn", `hooks.trigger ${event} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export async function seam<T>(
  ctx: Call,
  event: HookEvent,
  payload: unknown,
  map: (outcome: HookOutcome) => T,
): Promise<T | null> {
  const outcome = await triggerHook(ctx, event, payload);
  return hasOpinion(outcome) ? map(outcome) : null;
}

/// The one seam a question can come out of: a hook that answers `ask` hands the
/// call to the permission layer, and that answer becomes the decision. A
/// refusal is final and is never asked about, and an `ask` with nobody to ask
/// is a refusal, because a question must not quietly turn into a yes.
export async function preToolUse(
  ctx: Call,
  payload: unknown,
  tool: string,
  target: { session_id: string; cwd: string | null },
): Promise<PreToolDecision | null> {
  const outcome = await triggerHook(ctx, "PreToolUse", payload);
  if (!hasOpinion(outcome)) return null;
  if (outcome.decision !== "ask") return asPreTool(outcome);
  const allowed = await askPermission(ctx, tool, target, outcome.reason);
  return asPreTool({ ...outcome, decision: allowed ? "allow" : "deny" });
}

export async function askPermission(
  ctx: Call,
  tool: string,
  target: { session_id: string; cwd: string | null },
  reason: string | undefined,
): Promise<boolean> {
  if (ctx.capabilities.permission === undefined) {
    ctx.channel.log("warn", `a hook asked about ${tool} and there is no permission layer to ask`, { tool });
    return false;
  }
  try {
    const reply = (await ctx.channel.call(
      "permission",
      "request",
      { session_id: target.session_id, cwd: target.cwd, tool, ...(reason === undefined ? {} : { reason }) },
      { signal: ctx.signal },
    )) as { outcome?: unknown } | null;
    return reply?.outcome === "allowed-once";
  } catch (error) {
    ctx.channel.log("warn", `permission.request for ${tool} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
