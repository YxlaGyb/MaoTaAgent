/// The conversation a run is given and the record it leaves behind: the history
/// read from the session store, the fold that keeps a long one from filling the
/// window, the title a session is saved under, and the write itself. Every read
/// and write here crosses to the session capability, so the shapes accepted are
/// that store's durable shapes, and a summary that cannot be written leaves the
/// history alone rather than losing the turn.

import type { Call } from "@maota/plugin-kit";
import type { Message } from "@maota/agent-loop";
import type { HookEvent } from "@maota/hook-protocol";
import { compactMessage, foldCount, foldRequest, historyChars } from "./compact.ts";
import { settings } from "./levels.ts";
import type { SubagentOrigin } from "./subagent.ts";

export const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/// A title is the first line of what was asked, cut at a grapheme boundary so a
/// family emoji or an accented cluster is never split in half.
export function titleOf(text: unknown): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const all = [...segmenter.segment(flat)].map((piece) => piece.segment);
  return all.length > 30 ? `${all.slice(0, 30).join("")}…` : flat;
}

export async function loadHistory(ctx: Call, sessionId: string, cwd: string | null): Promise<Message[]> {
  const reply = (await ctx.channel.call(
    "session",
    "load",
    { id: sessionId, cwd: cwd ?? "" },
    { signal: ctx.signal },
  )) as { messages?: Message[] };
  return Array.isArray(reply?.messages) ? reply.messages : [];
}

/// A long history is folded before the turn runs, and the folded form is what
/// gets stored, so the next turn reads a note instead of replaying the day. A
/// summary that could not be written leaves the history alone: losing the turn
/// would be worse than spending the context.
export async function foldHistory(
  ctx: Call,
  history: Message[],
  session: { session_id: string; cwd: string | null; subagent: boolean },
  record: (event: HookEvent, payload: unknown) => Promise<void>,
): Promise<void> {
  if (historyChars(history) <= settings.compact_after_chars) return;
  const folded = foldCount(history, settings.compact_keep_messages);
  if (folded < 2) return;
  // Only a fold that is actually about to happen is announced, so a hook that
  // guards or annotates a conversation is not woken on every quiet turn.
  await record("PreCompact", { ...session, messages: folded });
  let summary: string | null = null;
  try {
    const reply = (await ctx.channel.call(
      "api",
      "chat",
      { messages: foldRequest(history.slice(0, folded)) },
      { signal: ctx.signal },
    )) as { message?: { content?: unknown } } | null;
    const content = reply?.message?.content;
    summary = typeof content === "string" && content.trim() !== "" ? content : null;
  } catch (error) {
    ctx.channel.log("warn", "agent: the history could not be folded", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (summary === null) return;
  history.splice(0, folded, compactMessage(summary, folded));
}

/// A context overflow is the one failure the conversation itself can answer, so
/// the older half is folded with the same summarising call the ordinary fold
/// uses. The system prompt is never part of it, and a conversation with nothing
/// foldable is left alone, because replacing the question would answer nothing.
export async function foldForOverflow(ctx: Call, messages: Message[], signal: AbortSignal): Promise<boolean> {
  const head = messages[0]?.role === "system" ? 1 : 0;
  const body = messages.slice(head);
  const folded = foldCount(body, Math.max(1, Math.floor(settings.compact_keep_messages / 2)));
  if (folded < 2) return false;
  try {
    const reply = (await ctx.channel.call(
      "api",
      "chat",
      { messages: foldRequest(body.slice(0, folded)) },
      { signal },
    )) as { message?: { content?: unknown } } | null;
    const content = reply?.message?.content;
    if (typeof content !== "string" || content.trim() === "") return false;
    messages.splice(head, folded, compactMessage(content.trim(), folded));
    return true;
  } catch (error) {
    ctx.channel.log("warn", "agent: the conversation could not be folded for a context overflow", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function persist(
  ctx: Call,
  sessionId: string,
  cwd: string | null,
  messages: readonly Message[],
  title: string,
  parent: SubagentOrigin | null,
): Promise<void> {
  await ctx.channel.call(
    "session",
    "save",
    {
      id: sessionId,
      cwd: cwd ?? "",
      title,
      messages,
      ...(parent === null
        ? {}
        : {
            parent: {
              id: parent.parent_session_id,
              cwd: cwd ?? "",
              call_id: parent.parent_call_id ?? "",
              type: parent.type,
              description: parent.description,
            },
          }),
    },
    { signal: ctx.signal },
  );
}
