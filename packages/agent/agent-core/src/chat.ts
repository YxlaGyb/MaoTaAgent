/// The one streaming call to the model, read into the two things the loop needs
/// from it: the deltas a front end watches and the final message the run
/// continues from. A stream that ends without a message is an error, not an
/// empty answer, and a stream cancelled mid-flight says so rather than looking
/// like a model that had nothing to say.
///
/// A model-request failure is the one thing that arrives as data: the adapter
/// reports it as a terminal chunk carrying the facts, so this file turns it back
/// into the failure it describes and lets the loop's policy decide what to do.
/// Everything else that goes wrong here is a defect in this process and throws.
///
/// A replaced attempt arrives as data too. The adapter decides on the
/// replacement, so a transcript that showed half of an answer learns it must
/// take that half back from here, and not from the failure that never came.

import { CallError, type Call } from "@maota/plugin-kit";
import { ModelFailureError, readModelFailure, type ChatDelta, type Message, type ToolSpec } from "@maota/agent-loop";

/// Which conversation this call is answering for, so a replacement the adapter
/// makes can be written down where the turn will be read afterwards.
export interface SessionRef {
  id: string;
  cwd: string;
  step: number;
}

export async function chatStream(
  ctx: Call,
  messages: readonly Message[],
  tools: readonly ToolSpec[],
  model: string | undefined,
  signal: AbortSignal,
  delta: (chunk: ChatDelta) => void,
  session: SessionRef,
): Promise<Message> {
  const stream = await ctx.channel.stream(
    "api",
    "chat",
    { messages, tools, session, ...(model === undefined ? {} : { model }) },
    { signal },
  );
  let final: Message | undefined;
  let failure: ModelFailureError | undefined;
  for await (const chunk of stream) {
    if (signal.aborted) break;
    const event = chunk as {
      type?: unknown;
      text?: unknown;
      message?: Message;
      failure?: unknown;
      phase?: unknown;
    } | null;
    if (event?.type === "delta" && typeof event.text === "string") delta({ text: event.text });
    else if (event?.type === "reasoning" && typeof event.text === "string") delta({ reasoning: event.text });
    else if (event?.type === "retry" && event.phase === "scheduled") delta({ retract: kindOf(event.failure) });
    else if (event?.type === "message" && event.message) final = event.message;
    else if (event?.type === "error") failure = reported(event.failure, event);
  }
  if (!final) {
    if (failure !== undefined) throw failure;
    if (signal.aborted) throw new CallError(-32013, "cancelled");
    throw new CallError(-32603, "api returned no message");
  }
  return final;
}

/// The kind is the label a transcript quotes when it takes an answer back, so a
/// replacement that could not be read still names itself rather than looking
/// like a retraction of nothing in particular.
function kindOf(payload: unknown): string {
  return readModelFailure(payload)?.kind ?? "unknown";
}

/// A chunk that names a failure but cannot be read is still a failure: it is
/// reported as `unknown` rather than dropped, because a silent stream and a
/// failed one must never look alike.
function reported(payload: unknown, event: unknown): ModelFailureError {
  const failure = readModelFailure(payload);
  if (failure !== null) return new ModelFailureError(failure);
  return new ModelFailureError({
    message: `the model call failed without readable details: ${JSON.stringify(event).slice(0, 200)}`,
    code: -32603,
    kind: "unknown",
  });
}
