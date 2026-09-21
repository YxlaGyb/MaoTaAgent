import type { Call } from "@maota/plugin-kit";

/// The command shapes this tool stops on. The list lives beside the tool that
/// runs commands: nothing else in the deployment inspects a command line.
const RISKY = ["rm ", "> /etc/", "chmod 777"];

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
export type Denial = Exclude<ApprovalOutcome, "allowed-once">;

const OUTCOMES = new Set<string>(["allowed-once", "rejected", "cancelled", "unavailable"]);

export interface ApprovalTarget {
  session_id: string;
  cwd: string;
  tool: string;
  call_id?: string;
  reason?: string;
}

export interface PwshRefusal {
  command: string;
  status: string;
  ok: boolean;
  reason: string;
}

const DENIALS: Record<Denial, string> = {
  rejected: "the user rejected this command, so it did not run",
  cancelled: "the approval request was withdrawn before a decision, so the command did not run",
  unavailable: "no approval answerer is available, so the command did not run",
};

export function needsApproval(command: string): boolean {
  return RISKY.some((word) => command.includes(word));
}

export function reasonOf(command: string): string {
  const found = RISKY.find((word) => command.includes(word)) ?? "a destructive shape";
  return `this command contains ${JSON.stringify(found)}, which the permission gate treats as destructive`;
}

/// Everything that is not a one-shot grant is a refusal: an absent capability, a
/// throwing call and an answer outside the vocabulary all land on `unavailable`.
export async function requestApproval(
  call: Call,
  target: ApprovalTarget,
  timeoutMs: number,
): Promise<ApprovalOutcome> {
  try {
    const reply = (await call.channel.call("permission", "request", target, {
      signal: call.signal,
      timeout_ms: timeoutMs,
    })) as { outcome?: unknown } | null;
    const outcome = String(reply?.outcome ?? "");
    return OUTCOMES.has(outcome) ? (outcome as ApprovalOutcome) : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function refusalOf(command: string, denial: Denial): PwshRefusal {
  return { command, status: "approval denied", ok: false, reason: DENIALS[denial] };
}
