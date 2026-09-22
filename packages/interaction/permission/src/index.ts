#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { CallError, packageVersion, runPlugin, type Call, type Channel, type Definition } from "@maota/plugin-kit";

import {
  MODES,
  decide,
  effectiveMode,
  isMode,
  pairingProblems,
  read,
  readRules,
  sessionIdOf,
  subagentOf,
  write,
  type AuditRecord,
  type GrantRecord,
  type Mode,
  type Outcome,
  type PermissionFile,
  type Rule,
  type SubagentRef,
} from "./store.ts";

const DEFAULTS = { mode: "ask" as Mode, maxRecords: 500, remember: false };

interface Settings {
  root: string;
  mode: Mode;
  maxRecords: number;
  remember: boolean;
  rules: Rule[];
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
  subagent?: SubagentRef;
  at: string;
  settle(outcome: Outcome, decidedBy: string, cause?: string): void;
}

function defaultRoot(): string {
  const home = process.env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "permissions");
}

let settings: Settings = {
  root: defaultRoot(),
  mode: DEFAULTS.mode,
  maxRecords: DEFAULTS.maxRecords,
  remember: DEFAULTS.remember,
  rules: [],
};

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

function askedRecord(
  id: string,
  tool: string,
  callId: string | undefined,
  reason: string | undefined,
  subagent: SubagentRef | undefined,
): AuditRecord {
  return {
    kind: "asked",
    at: now(),
    id,
    tool,
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}

function decidedRecord(
  id: string,
  outcome: Outcome,
  decidedBy: string,
  tool: string,
  cause: string | undefined,
  subagent: SubagentRef | undefined,
): AuditRecord {
  return {
    kind: "decided",
    at: now(),
    id,
    outcome,
    decided_by: decidedBy,
    tool,
    ...(cause === undefined ? {} : { cause }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}

function policy(params: unknown): { mode: Mode; grants: string[] } {
  const target = targetOf(params);
  const file = fileOf(target);
  return { mode: effectiveMode(file, settings.mode), grants: file.grants };
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
        ...(request.subagent === undefined ? {} : { subagent: request.subagent }),
      })),
  };
}

function answer(params: unknown, call: Call): { settled: boolean } {
  const input = (params ?? {}) as { id?: unknown; decision?: unknown; remember?: unknown };
  const id = text(input.id, "id");
  if (input.decision !== "allow" && input.decision !== "deny") {
    throw new CallError(-32602, `decision must be "allow" or "deny", got ${JSON.stringify(input.decision)}`);
  }
  const found = waiting.get(id);
  if (found === undefined) throw new CallError(-32602, `no pending request ${JSON.stringify(id)}`);
  // An allowance can be meant for this call or for every later call of the same
  // tool, and a deployment may make the second the default.
  const remember = input.remember === true || (input.remember === undefined && settings.remember);
  if (input.decision === "allow" && remember) {
    grant({ sessionId: found.session_id, cwd: found.cwd }, found.tool, answererId(call));
  }
  found.settle(input.decision === "allow" ? "allowed-once" : "rejected", answererId(call));
  return { settled: true };
}

/// A remembered answer is a grant, and a grant is written where the decision it
/// replaced is written: the file is the record of why a tool stopped asking.
function grant(target: Target, tool: string, caller: string): void {
  const file = fileOf(target);
  if (file.grants.includes(tool)) return;
  const record: GrantRecord = { kind: "grant", at: now(), tool, caller };
  write(settings.root, { ...file, grants: [...file.grants, tool], records: [...file.records, record] }, settings.maxRecords);
}

function forget(params: unknown, call: Call): { grants: string[] } {
  const target = targetOf(params);
  const input = (params ?? {}) as { tool?: unknown };
  const only = optionalText(input.tool);
  const file = fileOf(target);
  const kept = only === undefined ? [] : file.grants.filter((item) => item !== only);
  const revoked = file.grants.filter((item) => !kept.includes(item));
  if (revoked.length === 0) return { grants: file.grants };
  const records: GrantRecord[] = revoked.map((tool) => ({
    kind: "grant",
    at: now(),
    tool,
    caller: answererId(call),
    revoked: true,
  }));
  const next = write(
    settings.root,
    { ...file, grants: kept, records: [...file.records, ...records] },
    settings.maxRecords,
  );
  return { grants: next.grants };
}

/// A call id is claimed by whoever is asking, so it is checked against the
/// session it names whenever the session store is reachable. `null` means the
/// claim could not be checked, which is not the same as a claim being false.
async function callIdKnown(ctx: Call, target: Target, callId: string): Promise<boolean | null> {
  if (ctx.capabilities.session === undefined) return null;
  try {
    const document = (await ctx.channel.call(
      "session",
      "load",
      { id: target.sessionId, cwd: target.cwd },
      { signal: ctx.signal },
    )) as { messages?: unknown } | null;
    if (!Array.isArray(document?.messages)) return null;
    return document.messages.some((message) => {
      const calls = (message as { tool_calls?: unknown } | null)?.tool_calls;
      return Array.isArray(calls) && calls.some((item) => (item as { id?: unknown } | null)?.id === callId);
    });
  } catch (error) {
    ctx.channel.log("warn", "permission: the session could not be read to check a call id", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  subagent: SubagentRef | undefined,
): Promise<{ outcome: Outcome }> {
  append(target, [askedRecord(id, tool, callId, reason, subagent)]);
  announce(call.channel, "permission.requested", {
    id,
    session_id: target.sessionId,
    tool,
    at: now(),
    ...(callId === undefined ? {} : { call_id: callId }),
    ...(reason === undefined ? {} : { reason }),
    ...(subagent === undefined ? {} : { subagent }),
  });
  return new Promise<{ outcome: Outcome }>((resolve) => {
    function settle(outcome: Outcome, decidedBy: string, cause?: string): void {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      call.signal.removeEventListener("abort", onAbort);
      append(target, [decidedRecord(id, outcome, decidedBy, tool, cause, subagent)]);
      announce(call.channel, "permission.settled", {
        id,
        outcome,
        decided_by: decidedBy,
        at: now(),
        ...(subagent === undefined ? {} : { subagent }),
      });
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
      ...(subagent === undefined ? {} : { subagent }),
      settle,
    });
    call.signal.addEventListener("abort", onAbort, { once: true });
    if (call.signal.aborted) onAbort();
  });
}

async function request(params: unknown, call: Call): Promise<{ outcome: Outcome }> {
  const target = targetOf(params);
  const input = (params ?? {}) as { tool?: unknown; call_id?: unknown; reason?: unknown; subagent?: unknown };
  const tool = text(input.tool, "tool");
  const callId = optionalText(input.call_id);
  const reason = optionalText(input.reason);
  const subagent = subagentOf(input.subagent);
  const id = randomUUID();
  // A subagent asks under its parent's identity, and the call id it carries is
  // the parent's `task` call, which the parent's history already holds, so that
  // claim can be checked. A session's own call is the one in flight right now
  // and is not written down until the turn is saved, so checking it would call
  // every honest question a forgery.
  if (subagent !== undefined && callId !== undefined && call.capabilities.session !== undefined) {
    if ((await callIdKnown(call, target, callId)) === false) {
      throw new CallError(-32602, `call_id ${JSON.stringify(callId)} is not a call in this session`);
    }
  }
  const file = fileOf(target);
  const verdict = decide(effectiveMode(file, settings.mode), answerers.size, tool, settings.rules, file.grants);
  if (verdict === "ask") return await park(call, target, id, tool, callId, reason, subagent);
  if (verdict.cause === "no-answerer") {
    append(target, [
      askedRecord(id, tool, callId, reason, subagent),
      decidedRecord(id, verdict.outcome, verdict.decided_by, tool, verdict.cause, subagent),
    ]);
    return { outcome: verdict.outcome };
  }
  append(target, [decidedRecord(id, verdict.outcome, verdict.decided_by, tool, undefined, subagent)]);
  return { outcome: verdict.outcome };
}

const VERSION = packageVersion(import.meta.url);

export const definition: Definition = {
  provides: [{ capability: "permission", version: VERSION }],
  configKeys: ["mode", "dir", "max_records", "rules", "remember"],

  setup(wiring) {
    const configured = wiring.config.dir;
    settings = {
      root: typeof configured === "string" && configured.trim() !== "" ? configured : defaultRoot(),
      mode: isMode(wiring.config.mode) ? wiring.config.mode : DEFAULTS.mode,
      maxRecords: positive(wiring.config.max_records, DEFAULTS.maxRecords),
      remember: wiring.config.remember === true,
      rules: readRules(wiring.config.rules),
    };
  },

  methods: {
    policy,
    set_policy: setPolicy,
    register_answerer: registerAnswerer,
    unregister_answerer: unregisterAnswerer,
    pending: listPending,
    answer,
    forget,
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
    settings = { root, mode: "ask", maxRecords: 6, remember: false, rules: [] };
    const session = { session_id: "check", cwd: "E:\\work" };
    try {
      const full = decide("full", 0, "pwsh", [], []);
      if (full === "ask" || full.outcome !== "allowed-once" || full.decided_by !== "policy:full") {
        problems.push(`full decided ${JSON.stringify(full)}`);
      }
      const auto = decide("auto", 0, "pwsh", [], []);
      if (auto === "ask" || auto.outcome !== "allowed-once" || auto.decided_by !== "policy:auto") {
        problems.push(`auto decided ${JSON.stringify(auto)}`);
      }
      const alone = decide("ask", 0, "pwsh", [], []);
      if (alone === "ask" || alone.cause !== "no-answerer") {
        problems.push(`ask with no answerer decided ${JSON.stringify(alone)}`);
      }
      if (decide("ask", 1, "pwsh", [], []) !== "ask") {
        problems.push("ask with an answerer should hand the question over");
      }

      // Rules are read in table order and the first match decides, a rule that
      // asks outranks the mode, and a remembered grant outranks the mode too.
      const rules: Rule[] = [
        { match: "pwsh", action: "deny" },
        { match: "write", action: "allow" },
        { match: "edit", action: "ask" },
      ];
      const denied = decide("full", 1, "pwsh", rules, []);
      if (denied === "ask" || denied.outcome !== "rejected" || denied.cause !== "rule pwsh") {
        problems.push(`a denying rule decided ${JSON.stringify(denied)}`);
      }
      const byRule = decide("ask", 0, "write", rules, []);
      if (byRule === "ask" || byRule.decided_by !== "policy:rule") {
        problems.push(`an allowing rule decided ${JSON.stringify(byRule)}`);
      }
      if (decide("full", 1, "edit", rules, []) !== "ask") problems.push("a rule that asks lost to the mode");
      const unanswerable = decide("full", 0, "edit", rules, []);
      if (unanswerable === "ask" || unanswerable.cause !== "no-answerer") {
        problems.push(`a rule that asks with nobody listening decided ${JSON.stringify(unanswerable)}`);
      }
      let badRule = "";
      try {
        readRules([{ match: "x", action: "maybe" }]);
      } catch (error) {
        badRule = error instanceof Error ? error.message : String(error);
      }
      if (!badRule.includes("a rule action must be one of")) {
        problems.push(`readRules answered ${JSON.stringify(badRule)}`);
      }

      // A claim that the session can be read to check is only checked when it
      // comes from a subagent; the session's own call cannot be checked yet.
      const reader = {
        publish: channel.publish,
        log: (): void => {},
        call: async (capability: string, method: string): Promise<unknown> => {
          if (capability === "session" && method === "load") {
            return { messages: [{ role: "assistant", tool_calls: [{ id: "call_4" }] }] };
          }
          throw new Error(`no ${capability}/${method} here`);
        },
      } as unknown as Channel;
      const withSession = (): Call =>
        ({
          channel: reader,
          config: {},
          capabilities: { session: { plugin: "session", version: "1.4.0" } },
          capability: "permission",
          method: "request",
          caller: "web",
          signal: new AbortController().signal,
        }) as unknown as Call;
      settings = { ...settings, rules: [{ match: "pwsh", action: "deny" }] };
      const mine = await request({ ...session, tool: "pwsh", call_id: "call_9" }, withSession());
      if (mine.outcome !== "rejected") {
        problems.push(`a session's own in-flight call id was checked and decided ${JSON.stringify(mine)}`);
      }
      let forged = "";
      try {
        await request(
          {
            ...session,
            tool: "pwsh",
            call_id: "call_9",
            subagent: { id: "sub-1", type: "explore", description: "look" },
          },
          withSession(),
        );
      } catch (error) {
        forged = error instanceof Error ? error.message : String(error);
      }
      if (!forged.includes("call_9") || !forged.includes("is not a call in this session")) {
        problems.push(`a subagent's invented call id said ${JSON.stringify(forged)}`);
      }
      settings = { ...settings, rules: [] };

      const wire = { session_id: "check", cwd: "E:\\work" };
      grant({ sessionId: wire.session_id, cwd: wire.cwd }, "pwsh", "web");
      if (!policy(wire).grants.includes("pwsh")) problems.push("a remembered answer was not written down");
      if (decide("ask", 0, "pwsh", [], policy(wire).grants) === "ask") {
        problems.push("a remembered answer still asked");
      }
      forget({ ...wire, tool: "pwsh" }, call());
      if (policy(wire).grants.length !== 0) problems.push("forget left a grant behind");
      if (decide("ask", 1, "pwsh", [], policy(wire).grants) !== "ask") {
        problems.push("a withdrawn grant still allowed the tool");
      }

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

      const labelled = request(
        {
          ...session,
          tool: "pwsh",
          call_id: "task-1",
          subagent: { id: "sub-1", type: "explore", description: "look at the loader" },
        },
        call(),
      );
      const third = listPending({}).requests[0] as { id?: string; subagent?: { id?: string } } | undefined;
      if (third?.subagent?.id !== "sub-1") problems.push("the parked question lost its subagent");
      const lastAsk = published.filter((item) => item.topic === "permission.requested").at(-1)?.payload as
        | { subagent?: { id?: string }; call_id?: string }
        | undefined;
      if (lastAsk?.subagent?.id !== "sub-1" || lastAsk.call_id !== "task-1") {
        problems.push(`the published question carried ${JSON.stringify(lastAsk)}`);
      }
      answer({ id: third?.id, decision: "allow" }, call());
      if ((await labelled).outcome !== "allowed-once") problems.push("a labelled question should still settle");
      const audit = read(root, session.session_id, session.cwd).records;
      const askedLast = audit.filter((record) => record.kind === "asked").at(-1) as
        | { subagent?: { description?: string } }
        | undefined;
      const decidedLast = audit.filter((record) => record.kind === "decided").at(-1) as
        | { subagent?: { description?: string } }
        | undefined;
      if (askedLast?.subagent?.description !== "look at the loader") problems.push("the audit lost the subagent");
      if (decidedLast?.subagent?.description !== "look at the loader") {
        problems.push("the decision lost the subagent it answered");
      }
      let nameless = "";
      try {
        await request({ ...session, tool: "pwsh", subagent: { type: "explore" } }, call());
      } catch (error) {
        nameless = error instanceof Error ? error.message : String(error);
      }
      if (!nameless.includes("subagent.id")) problems.push(`a nameless subagent said ${JSON.stringify(nameless)}`);

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
