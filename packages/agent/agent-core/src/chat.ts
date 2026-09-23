/// The one streaming call to the model, read into the two things the loop needs
/// from it: the deltas a front end watches and the final message the run
/// continues from. A stream that ends without a message is an error, not an
/// empty answer, and a stream cancelled mid-flight says so rather than looking
/// like a model that had nothing to say.

import { CallError, type Call } from "@maota/plugin-kit";
import type { ChatDelta, Message, ToolSpec } from "@maota/agent-loop";

export async function chatStream(
  ctx: Call,
  messages: readonly Message[],
  tools: readonly ToolSpec[],
  model: string | undefined,
  signal: AbortSignal,
  delta: (chunk: ChatDelta) => void,
): Promise<Message> {
  const stream = await ctx.channel.stream(
    "api",
    "chat",
    { messages, tools, ...(model === undefined ? {} : { model }) },
    { signal },
  );
  let final: Message | undefined;
  for await (const chunk of stream) {
    if (signal.aborted) break;
    const event = chunk as { type?: unknown; text?: unknown; message?: Message } | null;
    if (event?.type === "delta" && typeof event.text === "string") delta({ text: event.text });
    else if (event?.type === "reasoning" && typeof event.text === "string") delta({ reasoning: event.text });
    else if (event?.type === "message" && event.message) final = event.message;
  }
  if (!final) {
    if (signal.aborted) throw new CallError(-32013, "cancelled");
    throw new CallError(-32603, "api returned no message");
  }
  return final;
}
