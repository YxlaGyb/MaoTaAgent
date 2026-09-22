import { randomUUID } from "node:crypto";

import { CallError, type Channel, type InboundStream } from "@maota/plugin-kit";

import type { BridgeFacts, HostEvent, SessionFile, SubagentRef } from "./protocol.ts";

interface LoopEvent {
  type?: string;
  text?: string;
  step?: number;
  tool?: string;
  id?: string;
  args?: unknown;
  ok?: boolean;
  output?: unknown;
  steps?: number;
}

interface Turn {
  session_id: string;
  abort: AbortController;
  stream: InboundStream | null;
  cancelled: boolean;
}

export interface Bridge {
  facts(): Promise<BridgeFacts>;
  handle(method: string, params: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: (event: HostEvent) => void): () => void;
  open(): Promise<void>;
  close(): void;
}

export function createBridge(channel: Channel): Bridge {
  const turns = new Map<string, Turn>();
  const listeners = new Set<(event: HostEvent) => void>();
  let subscription: string | null = null;

  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };

  /// The two permission topics become the two events the page understands. A
  /// page that missed one rebuilds from `permission.pending`, so a lost event
  /// only costs a repaint.
  function forwardPermission(topic: string, payload: unknown): HostEvent | null {
    const event = (payload ?? {}) as {
      id?: unknown;
      session_id?: unknown;
      tool?: unknown;
      call_id?: unknown;
      reason?: unknown;
      outcome?: unknown;
      subagent?: unknown;
    };
    const request_id = String(event.id ?? "");
    if (request_id === "") return null;
    if (topic === "permission.requested") {
      return {
        event: "permission.request",
        request_id,
        session_id: String(event.session_id ?? ""),
        tool: String(event.tool ?? ""),
        ...(event.call_id === undefined ? {} : { call_id: String(event.call_id) }),
        ...(event.reason === undefined ? {} : { reason: String(event.reason) }),
        ...(event.subagent === undefined ? {} : { subagent: event.subagent as SubagentRef }),
      };
    }
    if (topic === "permission.settled") {
      return { event: "permission.settled", request_id, outcome: String(event.outcome ?? "") };
    }
    return null;
  }

  /// A subagent has no turn of its own: its events belong to the turn running
  /// its parent session, which is the only turn the page keys anything by. An
  /// event that arrives with no such turn is dropped, and nothing breaks: the
  /// answer itself still comes back as the result of the `task` call.
  function forwardSubagent(topic: string, payload: unknown): HostEvent | null {
    const event = (payload ?? {}) as Record<string, unknown>;
    const parent = typeof event.parent_session_id === "string" ? event.parent_session_id : "";
    const turnId = parent === "" ? null : turnIdOf(parent);
    if (turnId === null) return null;
    return {
      event: `subagent.${topic.slice("agent.subagent.".length)}`,
      turn_id: turnId,
      subagent_id: typeof event.subagent_id === "string" ? event.subagent_id : "",
      parent_call_id: typeof event.parent_call_id === "string" ? event.parent_call_id : "",
      type: typeof event.type === "string" ? event.type : "",
      description: typeof event.description === "string" ? event.description : "",
      ...(typeof event.id === "string" ? { id: event.id } : {}),
      ...(typeof event.tool === "string" ? { tool: event.tool } : {}),
      ...(event.args === undefined ? {} : { args: event.args }),
      ...(typeof event.ok === "boolean" ? { ok: event.ok } : {}),
      ...(event.output === undefined ? {} : { output: event.output }),
      ...(typeof event.step === "number" ? { step: event.step } : {}),
      ...(typeof event.steps === "number" ? { steps: event.steps } : {}),
      ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
    };
  }

  function cwdOf(params: Record<string, unknown>): string {
    return typeof params.cwd === "string" ? params.cwd : "";
  }

  function sessionOf(params: Record<string, unknown>): string {
    return typeof params.session_id === "string" ? params.session_id : "";
  }

  function busy(sessionId: string): Turn | null {
    for (const turn of turns.values()) if (turn.session_id === sessionId) return turn;
    return null;
  }

  function turnIdOf(sessionId: string): string | null {
    for (const [turnId, turn] of turns) if (turn.session_id === sessionId) return turnId;
    return null;
  }

  function forward(turnId: string, data: unknown): boolean {
    const event = (data ?? {}) as LoopEvent;
    switch (event.type) {
      case "text":
        emit({ event: "text", turn_id: turnId, text: String(event.text ?? "") });
        return false;
      case "reasoning":
        emit({ event: "reasoning", turn_id: turnId, text: String(event.text ?? "") });
        return false;
      case "step":
        emit({ event: "step", turn_id: turnId, step: Number(event.step ?? 0) });
        return false;
      case "tool_call":
        emit({ event: "tool_call", turn_id: turnId, tool: String(event.tool ?? ""), id: String(event.id ?? ""), args: event.args });
        return false;
      case "tool_result":
        emit({
          event: "tool_result",
          turn_id: turnId,
          tool: String(event.tool ?? ""),
          ok: event.ok !== false,
          output: event.output,
        });
        return false;
      case "done":
        emit({
          event: "turn.done",
          turn_id: turnId,
          steps: Number(event.steps ?? 0),
          text: String(event.text ?? ""),
        });
        return true;
      default:
        return false;
    }
  }

  async function run(turnId: string, turn: Turn, params: Record<string, unknown>): Promise<void> {
    try {
      const stream = await channel.stream("agent.loop", "run", params, { signal: turn.abort.signal });
      turn.stream = stream;
      if (turn.cancelled) {
        stream.cancel();
        return;
      }
      for await (const data of stream) {
        if (turn.cancelled) break;
        if (forward(turnId, data)) return;
      }
      if (!turn.cancelled) {
        emit({ event: "turn.error", turn_id: turnId, code: -32603, message: "the agent never sent a closing event; this turn was cut off" });
      }
    } catch (error) {
      if (!turn.cancelled) {
        emit({
          event: "turn.error",
          turn_id: turnId,
          code: error instanceof CallError ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      turns.delete(turnId);
    }
  }

  async function send(params: Record<string, unknown>): Promise<{ turn_id: string }> {
    const session_id = typeof params.session_id === "string" ? params.session_id : "";
    if (session_id === "") throw new CallError(-32602, "chat.send: session_id is required");
    const input = typeof params.input === "string" ? params.input : "";
    if (input.trim() === "") throw new CallError(-32602, "chat.send: input is empty");

    const running = busy(session_id);
    if (running) {
      throw new CallError(
        -32602,
        running.cancelled ? `Session ${session_id} is still wrapping up the previous turn; please wait a moment` : `Session ${session_id} already has a running round; stop it first`,
      );
    }

    const turn_id = randomUUID();
    const turn: Turn = { session_id, abort: new AbortController(), stream: null, cancelled: false };
    turns.set(turn_id, turn);
    emit({ event: "turn.start", turn_id, session_id });
    void run(turn_id, turn, {
      session_id,
      cwd: typeof params.cwd === "string" ? params.cwd : "",
      input,
      thinking: typeof params.thinking === "string" && params.thinking !== "" ? params.thinking : "off",
    });
    return { turn_id };
  }

  function cancel(params: Record<string, unknown>): { cancelled: boolean } {
    const turnId = typeof params.turn_id === "string" ? params.turn_id : "";
    const turn = turns.get(turnId);
    if (!turn) throw new CallError(-32602, `unknown turn_id: ${JSON.stringify(turnId)}`);
    if (!turn.cancelled) {
      turn.cancelled = true;
      turn.abort.abort();
      turn.stream?.cancel();
      emit({ event: "turn.cancelled", turn_id: turnId });
    }
    return { cancelled: true };
  }

  return {
    async facts(): Promise<BridgeFacts> {
      const listed = await channel
        .call("session", "list", {})
        .then((reply) => (reply as { dir?: unknown } | null)?.dir)
        .catch(() => null);
      const agent = await channel
        .call("agent.loop", "info", {})
        .then((reply) => reply as { levels?: string[]; thinking?: unknown } | null)
        .catch(() => null);
      const keyed = await channel
        .call("api", "key", {})
        .then((reply) => (reply as { has_key?: unknown } | null)?.has_key)
        .catch(() => null);
      return {
        sessions_dir: typeof listed === "string" ? listed : null,
        levels: agent?.levels ?? [],
        thinking: (agent?.thinking as BridgeFacts["thinking"]) ?? null,
        has_key: typeof keyed === "boolean" ? keyed : null,
      };
    },

    async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
      switch (method) {
        case "sessions.list":
          return await channel.call("session", "list", {});
        case "sessions.load":
          return await channel.call("session", "load", {
            id: params.id,
            cwd: typeof params.cwd === "string" ? params.cwd : "",
          });
        case "sessions.children":
          return await channel.call("session", "children", { id: params.id, cwd: cwdOf(params) });
        case "settings.set_key":
          return await channel.call("api", "key_set", {
            api_key: typeof params.api_key === "string" ? params.api_key : "",
          });
        case "permission.get":
          return await channel.call("permission", "policy", { session_id: sessionOf(params), cwd: cwdOf(params) });
        case "permission.set":
          return await channel.call("permission", "set_policy", {
            session_id: sessionOf(params),
            cwd: cwdOf(params),
            mode: params.mode,
          });
        case "permission.answer":
          return await channel.call("permission", "answer", { id: params.id, decision: params.decision });
        case "permission.pending": {
          const session_id = sessionOf(params);
          const reply = await channel.call(
            "permission",
            "pending",
            session_id === "" ? {} : { session_id },
          );
          return reply;
        }
        case "chat.send":
          return await send(params);
        case "chat.cancel":
          return cancel(params);
        default:
          throw new CallError(-32601, `unknown method: ${method}`);
      }
    },

    async open(): Promise<void> {
      try {
        subscription = await channel.subscribe(
          ["permission.requested", "permission.settled", "agent.subagent.*"],
          (topic, _seq, payload) => {
            const event = topic.startsWith("agent.subagent.")
              ? forwardSubagent(topic, payload)
              : forwardPermission(topic, payload);
            if (event !== null) emit(event);
          },
        );
      } catch (error) {
        channel.log("warn", `web: could not subscribe to the permission topics: ${messageOf(error)}`);
      }
      try {
        await channel.call("permission", "register_answerer", {});
      } catch (error) {
        channel.log("warn", `web: no permission capability to answer for: ${messageOf(error)}`);
      }
    },

    onEvent(listener: (event: HostEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close(): void {
      if (subscription !== null) void channel.unsubscribe(subscription).catch(() => undefined);
      void channel.call("permission", "unregister_answerer", {}).catch(() => undefined);
      for (const [turnId, turn] of turns) {
        turn.cancelled = true;
        turn.abort.abort();
        turn.stream?.cancel();
        turns.delete(turnId);
      }
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { SessionFile };
