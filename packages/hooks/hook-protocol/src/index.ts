/// The hook dialect: the twelve events, what a hook answers with, and how several
/// answers fold into one. Every hook-shaped name lives here, so a loop and its
/// tools stay free of them and only the bridge that wires an engine into a loop
/// needs both vocabularies.
///
/// @module @maota/hook-protocol

/// The points an agent cycle passes through, under the names the wider hook
/// ecosystem uses. Each caller raises the ones it has: a run raises
/// `SessionStart` and `SessionEnd`, the model seam raises `PreModel` and
/// `PostModel`, a fold raises `PreCompact`, a delegation raises
/// `SubagentStart` and `SubagentStop`, and a run that stops to be read raises
/// `Notification`.
export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreModel",
  "PostModel",
  "PreCompact",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/// A hook is a plugin that provides a `hook.<name>` capability and implements
/// one method per event it declares, named after that event.
export const HOOK_CAPABILITY_PREFIX = "hook.";

export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value);
}

export function isHookCapability(name: string): boolean {
  return name.startsWith(HOOK_CAPABILITY_PREFIX) && name.length > HOOK_CAPABILITY_PREFIX.length;
}

/// The label a hook's contribution carries into a session, so a reader of the
/// stored messages can tell engine-supplied text from what a person typed.
export function hookLabel(capability: string): string {
  const name = capability.slice(HOOK_CAPABILITY_PREFIX.length);
  return `hook:${isHookCapability(capability) ? name : capability}`;
}

/// What a `hook.<name>` capability answers its `describe` call with.
export interface HookDescription {
  events: HookEvent[];
}

export interface UserPromptSubmitPayload {
  session_id: string;
  cwd: string | null;
  input: string;
}

export interface PreToolUsePayload {
  session_id: string;
  cwd: string | null;
  step: number;
  tool: string;
  args: unknown;
  call_id: string;
}

export interface PostToolUsePayload extends PreToolUsePayload {
  ok: boolean;
  output: unknown;
}

export interface StopPayload {
  session_id: string;
  cwd: string | null;
  steps: number;
  stop_active: boolean;
}

export interface SessionPayload {
  session_id: string;
  cwd: string | null;
  subagent: boolean;
}

export interface SessionEndPayload extends SessionPayload {
  steps: number;
  reason: string;
}

export interface ModelPayload extends SessionPayload {
  step: number;
}

export interface PostModelPayload extends ModelPayload {
  ok: boolean;
}

export interface CompactPayload extends SessionPayload {
  messages: number;
}

export interface SubagentPayload {
  session_id: string;
  cwd: string | null;
  subagent_id: string;
  type: string;
  description: string;
}

export interface NotificationPayload {
  session_id: string;
  cwd: string | null;
  text: string;
}

/// What a hook writes. Context is plain text because the engine stamps the
/// source on the hook's behalf.
export interface HookReply {
  decision?: "allow" | "deny" | "ask";
  reason?: string;
  args?: unknown;
  context?: string[];
  output?: unknown;
  preventContinuation?: boolean;
  steer?: string;
}

export interface HookNote {
  source: string;
  text: string;
}

/// Every matched hook folded into one answer. An empty outcome is the same as
/// no hook being configured at all.
export interface HookOutcome {
  decision?: "allow" | "deny" | "ask";
  reason?: string;
  args?: unknown;
  context?: HookNote[];
  output?: unknown;
  preventContinuation?: boolean;
  steer?: string;
}

export interface HookContribution {
  source: string;
  reply: HookReply;
}

export function clipContext(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (maxChars <= 0) return "";
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/// Fold what every matched hook said into one answer, strictest first: a single
/// refusal wins over any number of questions, and a question wins over any
/// number of allowances. Only the reasons of whichever of the two won survive.
/// Context accumulates in hook order, one `halt` is enough to halt, the first
/// hook that steers supplies the message, and the first hook that supplies
/// `args` or `output` supplies those.
export function mergeHookOutcomes(
  contributions: readonly HookContribution[],
  event: HookEvent,
  maxContextChars: number,
): HookOutcome {
  const refusals: string[] = [];
  const questions: string[] = [];
  const context: HookNote[] = [];
  let allowed = false;
  let preventContinuation = false;
  let steer: string | undefined;
  let args: unknown;
  let output: unknown;

  for (const { source, reply } of contributions) {
    if (reply.decision === "deny") {
      const reason = reply.reason?.trim();
      refusals.push(reason === undefined || reason === "" ? `${source} refused this ${event}` : reason);
    } else if (reply.decision === "ask") {
      const reason = reply.reason?.trim();
      questions.push(reason === undefined || reason === "" ? `${source} asked about this ${event}` : reason);
    } else if (reply.decision === "allow") {
      allowed = true;
    }
    if (args === undefined && reply.args !== undefined) args = reply.args;
    if (output === undefined && reply.output !== undefined) output = reply.output;
    for (const text of reply.context ?? []) {
      const clipped = clipContext(text, maxContextChars);
      if (clipped !== "") context.push({ source, text: clipped });
    }
    if (reply.preventContinuation === true) preventContinuation = true;
    if (steer === undefined && typeof reply.steer === "string" && reply.steer.trim() !== "") steer = reply.steer;
  }

  const outcome: HookOutcome = {};
  if (refusals.length > 0) {
    outcome.decision = "deny";
    outcome.reason = refusals.join("\n\n");
  } else if (questions.length > 0) {
    outcome.decision = "ask";
    outcome.reason = questions.join("\n\n");
  } else if (allowed) {
    outcome.decision = "allow";
  }
  if (args !== undefined) outcome.args = args;
  if (output !== undefined) outcome.output = output;
  if (context.length > 0) outcome.context = context;
  if (preventContinuation) outcome.preventContinuation = true;
  if (steer !== undefined) outcome.steer = steer;
  return outcome;
}
