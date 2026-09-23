/// The audit trail: the question a call waited on and the decision it got are
/// stamped with the moment they happened and appended to the session's file,
/// and the events published beside them are notifications a subscriber may not
/// be there to hear. Nothing here decides anything, it only writes down what
/// was decided.

import type { Channel } from "@maota/plugin-kit";

import { write, type AuditRecord, type Outcome, type SubagentRef } from "./store.ts";
import { fileOf, now, settings, type Target } from "./policy.ts";

export function append(target: Target, records: AuditRecord[]): void {
  const file = fileOf(target);
  write(settings.root, { ...file, records: [...file.records, ...records] }, settings.maxRecords);
}

/// Events are notifications a subscriber may not be there to hear, and a lost
/// one must never turn into a failed decision: the file is the record.
export function announce(channel: Channel, topic: string, payload: unknown): void {
  void channel.publish(topic, payload).catch(() => undefined);
}

export function askedRecord(
  id: string,
  tool: string,
  callId: string | undefined,
  reason: string | undefined,
  subagent: SubagentRef | undefined,
): AuditRecord {
  return {
    kind: "asked",
    at: now(),
    id,
    tool,
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}

export function decidedRecord(
  id: string,
  outcome: Outcome,
  decidedBy: string,
  tool: string,
  cause: string | undefined,
  subagent: SubagentRef | undefined,
): AuditRecord {
  return {
    kind: "decided",
    at: now(),
    id,
    outcome,
    decided_by: decidedBy,
    tool,
    ...(cause === undefined ? {} : { cause }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}
