#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { CallError, runPlugin, type Call, type Channel, type Definition } from "@maota/plugin-kit";

import {
  MODES,
  decide,
  effectiveMode,
  isMode,
  pairingProblems,
  read,
  sessionIdOf,
  write,
  type AuditRecord,
  type Mode,
  type Outcome,
  type PermissionFile,
} from "./store.ts";

const DEFAULTS = { mode: "ask" as Mode, maxRecords: 500 };

interface Settings {
  root: string;
  mode: Mode;
  maxRecords: number;
}

interface Target {
  sessionId: string;
  cwd: string;
}

interface Pending {
  id: string;
  session_id: string;
  cwd: string;
  tool: string;
  call_id?: string;
  reason?: string;
  at: string;
  settle(outcome: Outcome, decidedBy: string, cause?: string): void;
}

function defaultRoot(): string {
  const home = process.env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "permissions");
}

let settings: Settings = { root: defaultRoot(), mode: DEFAULTS.mode, maxRecords: DEFAULTS.maxRecords };

/// One entry per plugin that answers questions, keyed by its caller label, so a
/// restarted front end replaces its own registration instead of adding another.
const answerers = new Set<string>();
const waiting = new Map<string, Pending>();

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, name: string): string {
  const found = String(value ?? "");
  if (found === "") throw new CallError(-32602, `${name} must be a non-empty string`);
  return found;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function targetOf(params: unknown): Target {
  const input = (params ?? {}) as { session_id?: unknown; cwd?: unknown };
  return { sessionId: sessionIdOf(input.session_id), cwd: typeof input.cwd === "string" ? input.cwd : "" };
}

function answererId(call: Call): string {
  return call.caller === "" ? "answerer" : call.caller;
}

function fileOf(target: Target): PermissionFile {
  return read(settings.root, target.sessionId, target.cwd);
}

function append(target: Target, records: AuditRecord[]): void {
  const file = fileOf(target);
  write(settings.root, { ...file, records: [...file.records, ...records] }, settings.maxRecords);
}

/// Events are notifications a subscriber may not be there to hear, and a lost
/// one must never turn into a failed decision: the file is the record.
function announce(channel: Channel, topic: string, payload: unknown): void {
  void channel.publish(topic, payload).catch(() => undefined);
}

function askedRecord(id: string, tool: string, callId: string | undefined, reason: string | undefined): AuditRecord {
  return {
    kind: "asked",
    at: now(),
    id,
    tool,
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function decidedRecord(id: string, outcome: Outcome, decidedBy: string, tool: string, cause?: string): AuditRecord {
  return {
    kind: "decided",
    at: now(),
    id,
    outcome,
    decided_by: decidedBy,
    tool,
    ...(cause === undefined ? {} : { cause }),
  };
}

function policy(params: unknown): { mode: Mode } {
  const target = targetOf(params);
  return { mode: effectiveMode(fileOf(target), settings.mode) };
}

function setPolicy(params: unknown, call: Call): { mode: Mode } {
  const target = targetOf(params);
  const wanted = (params ?? {}) as { mode?: unknown };
  if (!isMode(wanted.mode)) {
    throw new CallError(-32602, `mode must be one of ${MODES.join(", ")}, got ${JSON.stringify(wanted.mode)}`);
  }
  const file = fileOf(target);
  if (effectiveMode(file, settings.mode) === wanted.mode) return { mode: wanted.mode };
  const record: AuditRecord = { kind: "policy", at: now(), mode: wanted.mode, caller: call.caller };
  write(settings.root, { ...file, mode: wanted.mode, records: [...file.records, record] }, settings.maxRecords);
  return { mode: wanted.mode };
}

function registerAnswerer(_params: unknown, call: Call): { answerers: number } {
  answerers.add(answererId(call));
  return { answerers: answerers.size };
}

function unregisterAnswerer(_params: unknown, call: Call): { answerers: number } {
  answerers.delete(answererId(call));
  return { answerers: answerers.size };
}

function listPending(params: unknown): { requests: unknown[] } {
  const found = (params ?? {}) as { session_id?: unknown };
  const only = optionalText(found.session_id);
  return {
    requests: [...waiting.values()]
      .filter((request) => only === undefined || request.session_id === only)
      .map((request) => ({
        id: request.id,
        session_id: request.session_id,
        tool: request.tool,
        at: request.at,
        ...(request.call_id === undefined ? {} : { call_id: request.call_id }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      })),
  };
}

function answer(params: unknown, call: Call): { settled: boolean } {
  const input = (params ?? {}) as { id?: unknown; decision?: unknown };
  const id = text(input.id, "id");
  if (input.decision !== "allow" && input.decision !== "deny") {
    throw new CallError(-32602, `decision must be "allow" or "deny", got ${JSON.stringify(input.decision)}`);
  }
  const found = waiting.get(id);
  if (found === undefined) throw new CallError(-32602, `no pending request ${JSON.stringify(id)}`);
  found.settle(input.decision === "allow" ? "allowed-once" : "rejected", answererId(call));
  return { settled: true };
}

/// Publish the question before waiting for it, so an answerer already listening
/// can answer while the caller is still parked.
function park(
  call: Call,
  target: Target,
  id: string,
  tool: string,
  callId: string | undefined,
  reason: string | undefined,
): Promise<{ outcome: Outcome }> {
  append(target, [askedRecord(id, tool, callId, reason)]);
  announce(call.channel, "permission.requested", {
    id,
    session_id: target.sessionId,
    tool,
    at: now(),
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
  });
  return new Promise<{ outcome: Outcome }>((resolve) => {
    function settle(outcome: Outcome, decidedBy: string, cause?: string): void {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      call.signal.removeEventListener("abort", onAbort);
      append(target, [decidedRecord(id, outcome, decidedBy, tool, cause)]);
      announce(call.channel, "permission.settled", { id, outcome, decided_by: decidedBy, at: now() });
      resolve({ outcome });
    }
    function onAbort(): void {
      settle("cancelled", "none", "aborted");
    }
    waiting.set(id, {
      id,
      session_id: target.sessionId,
      cwd: target.cwd,
      tool,
      at: now(),
      ...(callId === undefined ? {} : { call_id: callId }),
      ...(reason === undefined ? {} : { reason }),
      settle,
    });
    call.signal.addEventListener("abort", onAbort, { once: true });
    if (call.signal.aborted) onAbort();
  });
}

async function request(params: unknown, call: Call): Promise<{ outcome: Outcome }> {
  const target = targetOf(params);
  const input = (params ?? {}) as { tool?: unknown; call_id?: unknown; reason?: unknown };
  const tool = text(input.tool, "tool");
  const callId = optionalText(input.call_id);
  const reason = optionalText(input.reason);
  const id = randomUUID();
  const verdict = decide(effectiveMode(fileOf(target), settings.mode), answerers.size);
  if (verdict === "ask") return await park(call, target, id, tool, callId, reason);
  if (verdict.cause === "no-answerer") {
    append(target, [
      askedRecord(id, tool, callId, reason),
      decidedRecord(id, verdict.outcome, verdict.decided_by, tool, verdict.cause),
    ]);
    return { outcome: verdict.outcome };
  }
  append(target, [decidedRecord(id, verdict.outcome, verdict.decided_by, tool)]);
  return { outcome: verdict.outcome };
}

export const definition: Definition = {
  provides: [{ capability: "permission", version: "1.0.0" }],
  configKeys: ["mode", "dir", "max_records"],

  setup(wiring) {
    const configured = wiring.config.dir;
    settings = {
      root: typeof configured === "string" && configured.trim() !== "" ? configured : defaultRoot(),
      mode: isMode(wiring.config.mode) ? wiring.config.mode : DEFAULTS.mode,
      maxRecords: positive(wiring.config.max_records, DEFAULTS.maxRecords),
    };
  },

  methods: {
    policy,
    set_policy: setPolicy,
    register_answerer: registerAnswerer,
    unregister_answerer: unregisterAnswerer,
    pending: listPending,
    answer,
    request,
  },

  close() {
    for (const found of [...waiting.values()]) found.settle("cancelled", "kernel", "closed");
  },

  async selfCheck() {
    const problems: string[] = [];
    const previous = settings;
    const root = mkdtempSync(join(tmpdir(), "maota-permission-check-"));
    const published: Array<{ topic: string; payload: unknown }> = [];
    const channel = {
      publish: (topic: string, payload: unknown): Promise<void> => {
        published.push({ topic, payload });
        return Promise.resolve();
      },
      log: (): void => {},
    } as unknown as Channel;
    const call = (signal?: AbortSignal): Call =>
      ({
        channel,
        config: {},
        capabilities: {},
        capability: "permission",
        method: "request",
        caller: "web",
        signal: signal ?? new AbortController().signal,
        stream: undefined,
      }) as unknown as Call;
    const asked = (): number => published.filter((item) => item.topic === "permission.requested").length;
    settings = { root, mode: "ask", maxRecords: 6 };
    const session = { session_id: "check", cwd: "E:\\work" };
    try {
      const full = decide("full", 0);
      if (full === "ask" || full.outcome !== "allowed-once" || full.decided_by !== "policy:full") {
        problems.push(`full decided ${JSON.stringify(full)}`);
      }
      const auto = decide("auto", 0);
      if (auto === "ask" || auto.outcome !== "allowed-once" || auto.decided_by !== "policy:auto") {
        problems.push(`auto decided ${JSON.stringify(auto)}`);
      }
      const alone = decide("ask", 0);
      if (alone === "ask" || alone.cause !== "no-answerer") {
        problems.push(`ask with no answerer decided ${JSON.stringify(alone)}`);
      }
      if (decide("ask", 1) !== "ask") problems.push("ask with an answerer should hand the question over");

      if (policy(session).mode !== "ask") problems.push("a fresh session should fall back to the configured mode");
      registerAnswerer({}, call());
      if (registerAnswerer({}, call()).answerers !== 1) {
        problems.push("a second registration from one plugin should replace itself, not add another");
      }

      const allowed = request(
        { ...session, tool: "pwsh", call_id: "c-1", reason: "the command looks destructive" },
        call(),
      );
      const first = listPending({}).requests[0] as { id?: string } | undefined;
      if (first?.id === undefined) problems.push("the ask should have been parked");
      if (asked() !== 1) problems.push(`the ask published ${asked()} requests`);
      answer({ id: first?.id, decision: "allow" }, call());
      if ((await allowed).outcome !== "allowed-once") problems.push("an allow should grant once");
      let late = "";
      try {
        answer({ id: first?.id, decision: "allow" }, call());
      } catch (error) {
        late = error instanceof Error ? error.message : String(error);
      }
      if (!late.includes("no pending request")) problems.push(`a late answer said ${JSON.stringify(late)}`);

      const rejecting = request({ ...session, tool: "pwsh" }, call());
      const second = listPending({}).requests[0] as { id?: string } | undefined;
      answer({ id: second?.id, decision: "deny" }, call());
      if ((await rejecting).outcome !== "rejected") problems.push("a deny should refuse");

      const controller = new AbortController();
      const aborted = request({ ...session, tool: "pwsh" }, call(controller.signal));
      controller.abort();
      if ((await aborted).outcome !== "cancelled") problems.push("an abort should withdraw the question");

      unregisterAnswerer({}, call());
      if ((await request({ ...session, tool: "pwsh" }, call())).outcome !== "unavailable") {
        problems.push("a question with no answerer should fail closed");
      }
      const before = asked();
      if (setPolicy({ ...session, mode: "auto" }, call()).mode !== "auto") problems.push("set_policy should stick");
      if (policy(session).mode !== "auto") problems.push("a saved policy should be read back");
      if ((await request({ ...session, tool: "pwsh" }, call())).outcome !== "allowed-once") {
        problems.push("auto should approve without asking");
      }
      setPolicy({ ...session, mode: "auto" }, call());
      if (asked() !== before) problems.push("a policy that approves by itself should never publish a question");

      const file = read(root, session.session_id, session.cwd);
      problems.push(...pairingProblems(file.records));
      if (file.records.length > settings.maxRecords) {
        problems.push(`the file kept ${file.records.length} records over the cap of ${settings.maxRecords}`);
      }
      let refused = "";
      try {
        sessionIdOf("not a session");
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
      if (refused === "") problems.push("a session id with a space should be refused");
    } catch (error) {
      problems.push(`selfCheck threw: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      settings = previous;
      rmSync(root, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
