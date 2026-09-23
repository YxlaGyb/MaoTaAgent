/// What a turn says before the model answers: the tool surface it offers, the
/// skill catalog it attaches, the approval policy it states, whether a call is
/// safe to run unattended, and the assembled system prompt it opens with. Each
/// one is a call to a capability, so this file owns the shape a turn asks those
/// capabilities for and nothing about how the run uses the answers.

import { CallError, type Call } from "@maota/plugin-kit";
import type { Message, ToolCall, ToolSpec } from "@maota/agent-loop";
import { catalogMessage, lastCatalogEntries, sameCatalog, type CatalogEntry } from "./catalog.ts";
import { injectHostArgs, readToolList, type HostValues } from "./tools.ts";
import { skillsOn } from "./hooks.ts";

export async function classifyTool(
  ctx: Call,
  spec: ToolSpec | undefined,
  call: ToolCall,
  host: HostValues,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const reply = (await ctx.channel.call(
      "tools",
      "classify",
      { name: call.name, args: injectHostArgs(spec, call.args, host) },
      { signal },
    )) as { safe?: unknown } | null;
    return reply?.safe === true;
  } catch {
    return false;
  }
}

export async function listTools(ctx: Call): Promise<ToolSpec[]> {
  return readToolList(await ctx.channel.call("tools", "list", {}, { signal: ctx.signal }));
}

function readCatalog(reply: unknown): { complete: boolean; entries: CatalogEntry[]; text: string } | null {
  if (reply === null || typeof reply !== "object") return null;
  const input = reply as { complete?: unknown; entries?: unknown; text?: unknown };
  if (typeof input.text !== "string" || input.text.trim() === "") return null;
  if (!Array.isArray(input.entries)) return null;
  const entries: CatalogEntry[] = [];
  for (const raw of input.entries) {
    if (raw === null || typeof raw !== "object") return null;
    const entry = raw as { name?: unknown; description?: unknown };
    if (typeof entry.name !== "string" || entry.name === "" || typeof entry.description !== "string") return null;
    entries.push({ name: entry.name, description: entry.description });
  }
  return { complete: input.complete === true, entries, text: input.text };
}

/// The catalog is the cheap half of the two level load, and it is durable: the
/// newest note in the history is what the model already read, so a turn that
/// would send the same lines sends nothing, a turn whose catalog moved appends a
/// replacement, and an incomplete read never rewrites the model's view.
export async function catalogNote(
  ctx: Call,
  history: readonly Message[],
  cwd: string | null,
  touched: readonly string[],
): Promise<Message | null> {
  if (!skillsOn()) return null;
  let reply: unknown;
  try {
    reply = await ctx.channel.call("skill", "catalog", { cwd: cwd ?? "", touched }, { signal: ctx.signal });
  } catch (error) {
    ctx.channel.log("warn", "agent: the skill catalog could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const catalog = readCatalog(reply);
  if (catalog === null) {
    ctx.channel.log("warn", "agent: the skill catalog came back unreadable");
    return null;
  }
  if (!catalog.complete) return null;
  const previous = lastCatalogEntries(history);
  if (previous !== null && sameCatalog(previous, catalog.entries)) return null;
  if (previous === null && catalog.entries.length === 0) return null;
  return catalogMessage(catalog.text, catalog.entries, previous);
}

/// The policy is read so the prompt can state it, and a deployment without a
/// permission capability simply says nothing about approval.
export async function approvalMode(ctx: Call, sessionId: string, cwd: string): Promise<string | null> {
  try {
    const reply = (await ctx.channel.call(
      "permission",
      "policy",
      { session_id: sessionId, cwd },
      { signal: ctx.signal },
    )) as { mode?: unknown } | null;
    return typeof reply?.mode === "string" ? reply.mode : null;
  } catch {
    return null;
  }
}

/// Everything the harness says before the conversation belongs to one plugin,
/// and this loop only hands over the facts a turn knows: a fact the prompt
/// states and the loop acts on is read once, in one process, so the two cannot
/// drift apart, and a deployment hears its own words without a build.
export async function assemblePrompt(
  ctx: Call,
  sessionId: string,
  cwd: string | null,
  approval: string | null,
  persona: string | undefined,
): Promise<string> {
  const reply = (await ctx.channel.call(
    "system-prompt",
    "assemble",
    {
      session_id: sessionId,
      cwd: cwd ?? "",
      approval: approval ?? "",
      ...(persona === undefined ? {} : { persona }),
    },
    { signal: ctx.signal },
  )) as { text?: unknown } | null;
  if (typeof reply?.text !== "string") throw new CallError(-32603, "the system prompt came back unreadable");
  return reply.text;
}
