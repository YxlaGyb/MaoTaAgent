import { asText, type Message } from "@maota/agent-loop";

/// A long conversation is folded into one note rather than replayed whole. This
/// file owns the three shapes that involves: which messages go into the note,
/// what the note says, and the one message a turn adds when the step ceiling
/// ended it mid-task.

export interface CompactNote {
  kind: "compact";
  folded: number;
}

/// A note written by a build that meant something else by `folded` is not a
/// baseline, so it reads as no note at all rather than half understood.
export function compactNote(source: unknown): CompactNote | null {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const input = source as Record<string, unknown>;
  if (input.kind !== "compact") return null;
  if (typeof input.folded !== "number" || !Number.isInteger(input.folded) || input.folded < 1) return null;
  return { kind: "compact", folded: input.folded };
}

function chars(message: Message): number {
  const content = typeof message.content === "string" ? message.content : "";
  const calls = Array.isArray(message.tool_calls) ? asText(message.tool_calls).length : 0;
  return content.length + calls;
}

/// The budget is measured over the text a provider would be sent, which is the
/// only number that decides whether a call still fits.
export function historyChars(messages: readonly Message[]): number {
  return messages.reduce((total, message) => total + chars(message), 0);
}

/// The newest `keep` messages stay whole. A tool result never travels without
/// the call that asked for it, so a boundary that lands inside one moves
/// forward until it stands at the start of a message the model wrote.
export function foldCount(messages: readonly Message[], keep: number): number {
  let boundary = messages.length - keep;
  if (boundary < 0) boundary = 0;
  while (boundary < messages.length && (messages[boundary] as Message).role === "tool") boundary += 1;
  return boundary;
}

const FOLD_INSTRUCTION =
  "Fold the conversation above into one note for a reader who has to continue this work. " +
  "Keep every fact that is still binding: what was asked for, the decisions taken, the files and " +
  "commands that matter, and what is still open. Drop anything settled and anything decorative. " +
  "Answer with the note only.";

/// The summarising call is an ordinary `api.chat`, so a deployment with a
/// scripted or local backend folds a conversation the same way.
export function foldRequest(folded: readonly Message[]): Message[] {
  return [
    { role: "system", content: "You are compacting an agent conversation." },
    ...folded,
    { role: "user", content: FOLD_INSTRUCTION },
  ];
}

export function compactMessage(summary: string, folded: number): Message {
  return { role: "user", name: "compact", content: summary, source: { kind: "compact", folded } };
}

/// A turn that hit `max_steps` is not finished, and the next turn has to know
/// it: the note is stored like any other message, so a restart reads it too.
export function continueNote(steps: number): Message {
  return {
    role: "user",
    name: "agent:max_steps",
    content:
      `This turn stopped at its step ceiling (${steps} model calls) with the work unfinished. ` +
      "Continue from here: everything above is still in force.",
  };
}
