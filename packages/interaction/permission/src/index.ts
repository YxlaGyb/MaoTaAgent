#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CallError, runPlugin, type Call, type Channel, type Definition } from "@maota/plugin-kit";

import {
  decide,
  effectiveMode,
  isMode,
  pairingProblems,
  read,
  readRules,
  sessionIdOf,
  subagentOf,
  type Outcome,
  type Rule,
} from "./store.ts";
import {
  DEFAULTS,
  configure,
  defaultRoot,
  fileOf,
  forget,
  grant,
  policy,
  setPolicy,
  settings,
  targetOf,
  text,
  optionalText,
  type Target,
} from "./policy.ts";
import { append, askedRecord, decidedRecord } from "./records.ts";
import {
  answer,
  answererCount,
  cancelAll,
  listPending,
  park,
  registerAnswerer,
  unregisterAnswerer,
} from "./pending.ts";

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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
  const verdict = decide(effectiveMode(file, settings.mode), answererCount(), tool, settings.rules, file.grants);
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

export const definition: Definition = {
  provides: ["permission"],
  configKeys: ["mode", "dir", "max_records", "rules", "remember"],

  setup(wiring) {
    const configured = wiring.config.dir;
    configure({
      root: typeof configured === "string" && configured.trim() !== "" ? configured : defaultRoot(),
      mode: isMode(wiring.config.mode) ? wiring.config.mode : DEFAULTS.mode,
      maxRecords: positive(wiring.config.max_records, DEFAULTS.maxRecords),
      remember: wiring.config.remember === true,
      rules: readRules(wiring.config.rules),
    });
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
    cancelAll("kernel", "closed");
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
    configure({ root, mode: "ask", maxRecords: 6, remember: false, rules: [] });
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
          capabilities: { session: { plugin: "session" } },
          capability: "permission",
          method: "request",
          caller: "web",
          signal: new AbortController().signal,
        }) as unknown as Call;
      configure({ ...settings, rules: [{ match: "pwsh", action: "deny" }] });
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
      configure({ ...settings, rules: [] });

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
      configure(previous);
      rmSync(root, { recursive: true, force: true });
    }
    return problems;
  },
};

runPlugin(definition);
