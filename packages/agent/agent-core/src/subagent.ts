/// A run's optional subagent identity and the parameters that describe how it
/// was started: the origin it carries, the system prompt it overrides, its tool
/// allow and deny lists, its step budget and its delegation depth, plus the one
/// way a run is started from inside another. Every reader here is a read of a
/// parameter that crossed a process boundary, so a shape the deployment could
/// not have meant is refused rather than half understood.

import { CallError, type Call } from "@maota/plugin-kit";
import type { ToolCall } from "@maota/agent-loop";

export interface SubagentOrigin {
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

/// Which subagent a run is: the id of its own session and the identity of the
/// call that spawned it, so every event it publishes names both ends.
export interface SubagentRef {
  subagent_id: string;
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

/// `origin` turns a run into a subagent: a fresh conversation, spawned by the
/// tool call it names, that keeps the identity of the parent it serves.
export function readOrigin(value: unknown): SubagentOrigin | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, `origin must be an object, got ${JSON.stringify(value)}`);
  }
  const raw = value as Record<string, unknown>;
  const parent = raw.parent_session_id;
  if (typeof parent !== "string" || parent === "") {
    throw new CallError(
      -32602,
      `origin.parent_session_id must name the session that spawned this run, got ${JSON.stringify(parent)}`,
    );
  }
  const text = (name: string): string | null => {
    const found = raw[name];
    if (found === undefined || found === null) return null;
    if (typeof found !== "string") {
      throw new CallError(-32602, `origin.${name} must be a string, got ${JSON.stringify(found)}`);
    }
    return found;
  };
  return {
    parent_session_id: parent,
    parent_call_id: text("parent_call_id"),
    type: text("type") ?? "general",
    description: text("description") ?? "",
  };
}

export function readSystem(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CallError(-32602, `system must be a string, got ${JSON.stringify(value)}`);
  return value.trim() === "" ? undefined : value;
}

export function readNames(value: unknown, name: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new CallError(-32602, `${name} must be an array of tool names`);
  const names = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  if (names.length !== value.length) throw new CallError(-32602, `${name} must hold non-empty tool names`);
  return names;
}

export function readSteps(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new CallError(-32602, `max_steps must be a positive whole number, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readDepth(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CallError(-32602, `depth must be a whole number of delegations, got ${JSON.stringify(value)}`);
  }
  return value;
}

/// A forked body runs as its own run and only its last words come back: the
/// instructions it followed and the tools it used are its business, and the
/// call that asked for it wants a result.
export async function runFork(
  ctx: Call,
  identity: string,
  cwd: string | null,
  invoked: ToolCall,
  body: string,
  label: string,
): Promise<string> {
  let stream;
  try {
    stream = await ctx.channel.stream(
      "agent.loop",
      "run",
      {
        session_id: `${identity}:${invoked.id}`,
        cwd,
        input: body,
        origin: {
          parent_session_id: identity,
          parent_call_id: invoked.id,
          type: "skill",
          description: label,
        },
        tools_deny: ["skill"],
      },
      { signal: ctx.signal },
    );
  } catch (error) {
    return `the skill body could not be run on its own: ${error instanceof Error ? error.message : String(error)}`;
  }
  let done: { text?: unknown; reason?: unknown } | null = null;
  try {
    for await (const chunk of stream) {
      const event = chunk as { type?: unknown; text?: unknown; reason?: unknown } | null;
      if (event?.type === "done") done = event;
    }
  } catch (error) {
    return `the skill body failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (done === null) return "the skill body ended without a result";
  return typeof done.text === "string" ? done.text : "";
}
