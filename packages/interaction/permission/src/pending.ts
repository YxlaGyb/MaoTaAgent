/// The question queue: which plugins are answering, which questions are parked
/// and how a parked one is settled. The registration and the map are one piece
/// of process state, so both live here and `index.ts` reaches them only through
/// the operations exported below.

import { CallError, type Call } from "@maota/plugin-kit";

import { type Outcome, type SubagentRef } from "./store.ts";
import { answererId, grant, now, optionalText, settings, text, type Target } from "./policy.ts";
import { announce, append, askedRecord, decidedRecord } from "./records.ts";

interface Pending {
  id: string;
  session_id: string;
  cwd: string;
  tool: string;
  call_id?: string;
  reason?: string;
  subagent?: SubagentRef;
  at: string;
  settle(outcome: Outcome, decidedBy: string, cause?: string): void;
}

/// One entry per plugin that answers questions, keyed by its caller label, so a
/// restarted front end replaces its own registration instead of adding another.
const answerers = new Set<string>();
const waiting = new Map<string, Pending>();

export function answererCount(): number {
  return answerers.size;
}

export function registerAnswerer(_params: unknown, call: Call): { answerers: number } {
  answerers.add(answererId(call));
  return { answerers: answerers.size };
}

export function unregisterAnswerer(_params: unknown, call: Call): { answerers: number } {
  answerers.delete(answererId(call));
  return { answerers: answerers.size };
}

export function listPending(params: unknown): { requests: unknown[] } {
  const found = (params ?? {}) as { session_id?: unknown };
  const only = optionalText(found.session_id);
  return {
    requests: [...waiting.values()]
      .filter((request) => only === undefined || request.session_id === only)
      .map((request) => ({
        id: request.id,
        session_id: request.session_id,
        tool: request.tool,
        at: request.at,
        ...(request.call_id === undefined ? {} : { call_id: request.call_id }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        ...(request.subagent === undefined ? {} : { subagent: request.subagent }),
      })),
  };
}

export function answer(params: unknown, call: Call): { settled: boolean } {
  const input = (params ?? {}) as { id?: unknown; decision?: unknown; remember?: unknown };
  const id = text(input.id, "id");
  if (input.decision !== "allow" && input.decision !== "deny") {
    throw new CallError(-32602, `decision must be "allow" or "deny", got ${JSON.stringify(input.decision)}`);
  }
  const found = waiting.get(id);
  if (found === undefined) throw new CallError(-32602, `no pending request ${JSON.stringify(id)}`);
  // An allowance can be meant for this call or for every later call of the same
  // tool, and a deployment may make the second the default.
  const remember = input.remember === true || (input.remember === undefined && settings.remember);
  if (input.decision === "allow" && remember) {
    grant({ sessionId: found.session_id, cwd: found.cwd }, found.tool, answererId(call));
  }
  found.settle(input.decision === "allow" ? "allowed-once" : "rejected", answererId(call));
  return { settled: true };
}

/// Publish the question before waiting for it, so an answerer already listening
/// can answer while the caller is still parked.
export function park(
  call: Call,
  target: Target,
  id: string,
  tool: string,
  callId: string | undefined,
  reason: string | undefined,
  subagent: SubagentRef | undefined,
): Promise<{ outcome: Outcome }> {
  append(target, [askedRecord(id, tool, callId, reason, subagent)]);
  announce(call.channel, "permission.requested", {
    id,
    session_id: target.sessionId,
    tool,
    at: now(),
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
    ...(subagent === undefined ? {} : { subagent }),
  });
  return new Promise<{ outcome: Outcome }>((resolve) => {
    function settle(outcome: Outcome, decidedBy: string, cause?: string): void {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      call.signal.removeEventListener("abort", onAbort);
      append(target, [decidedRecord(id, outcome, decidedBy, tool, cause, subagent)]);
      announce(call.channel, "permission.settled", {
        id,
        outcome,
        decided_by: decidedBy,
        at: now(),
        ...(subagent === undefined ? {} : { subagent }),
      });
      resolve({ outcome });
    }
    function onAbort(): void {
      settle("cancelled", "none", "aborted");
    }
    waiting.set(id, {
      id,
      session_id: target.sessionId,
      cwd: target.cwd,
      tool,
      at: now(),
      ...(callId === undefined ? {} : { call_id: callId }),
      ...(reason === undefined ? {} : { reason }),
      ...(subagent === undefined ? {} : { subagent }),
      settle,
    });
    call.signal.addEventListener("abort", onAbort, { once: true });
    if (call.signal.aborted) onAbort();
  });
}

/// Closing the plugin withdraws every question still parked: a caller waiting
/// on an answer that can never come would wait forever.
export function cancelAll(decidedBy: string, cause: string): void {
  for (const found of [...waiting.values()]) found.settle("cancelled", decidedBy, cause);
}
