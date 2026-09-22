#!/usr/bin/env node
import { CallError, runPlugin, type Call, type Channel, type Definition, type Wiring } from "@maota/plugin-kit";
import {
  runLoop,
  sourcedMessages,
  type ChatDelta,
  type LoopEvent,
  type LoopState,
  type Message,
  type PostToolDecision,
  type PreToolDecision,
  type StopDecision,
  type ToolCall,
  type ToolSpec,
} from "@maota/agent-loop";
import type { HookEvent, HookOutcome } from "@maota/hook-protocol";
import { systemPrompt, type SkillSummary } from "./prompt.ts";
import {
  SKILL_TOOL,
  hostValue,
  injectHostArgs,
  readToolList,
  stripHostArgs,
  type HostValues,
} from "./tools.ts";

export const LEVELS = ["off", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export interface LevelSetting {
  model?: string;
  tools: boolean;
}

const DEFAULTS = {
  max_steps: 8,
  max_parallel_tools: 4,
  system:
    "You are MaoTa's coding assistant, running on Windows. Use read, glob and edit for files, " +
    "and pwsh to run commands; do not guess, and do not reach for Unix commands such as tail " +
    "or sed. Answer in the user's language, briefly.",
  thinking: {} as Partial<Record<Level, LevelSetting>>,
};

let settings = { ...DEFAULTS };

/// The thinking level and model of every run that is in flight, keyed by the
/// session it is serving, so a subagent the run spawns inherits them: the loop
/// keeps no other link back to its parent.
const active = new Map<string, LevelSetting>();

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function readLevel(value: unknown): Level {
  if (value === undefined || value === null || value === "") return "off";
  if (!isLevel(value)) {
    throw new CallError(-32602, `thinking must be one of ${LEVELS.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readThinking(value: unknown): Partial<Record<Level, LevelSetting>> {
  const out: Partial<Record<Level, LevelSetting>> = {};
  if (value === null || typeof value !== "object") return out;
  for (const level of LEVELS) {
    const raw = (value as Record<string, unknown>)[level];
    if (typeof raw === "string") {
      if (raw !== "") out[level] = { model: raw, tools: true };
    } else if (raw !== null && typeof raw === "object") {
      const table = raw as { model?: unknown; tools?: unknown };
      out[level] = {
        ...(typeof table.model === "string" && table.model !== "" ? { model: table.model } : {}),
        tools: table.tools !== false,
      };
    }
  }
  return out;
}

export function resolveLevel(thinking: Partial<Record<Level, LevelSetting>>, level: Level): LevelSetting {
  return thinking[level] ?? { tools: true };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function titleOf(text: unknown): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const all = [...segmenter.segment(flat)].map((piece) => piece.segment);
  return all.length > 30 ? `${all.slice(0, 30).join("")}…` : flat;
}

export interface SubagentOrigin {
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

interface SubagentRef {
  subagent_id: string;
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

/// `origin` turns a run into a subagent: a fresh conversation, spawned by the
/// tool call it names, that keeps the identity of the parent it serves.
function readOrigin(value: unknown): SubagentOrigin | null {
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

function readSystem(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CallError(-32602, `system must be a string, got ${JSON.stringify(value)}`);
  return value.trim() === "" ? undefined : value;
}

function readNames(value: unknown, name: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new CallError(-32602, `${name} must be an array of tool names`);
  const names = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  if (names.length !== value.length) throw new CallError(-32602, `${name} must hold non-empty tool names`);
  return names;
}

function readSteps(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new CallError(-32602, `max_steps must be a positive whole number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/// A bus event is a broadcast a subscriber may not be there to hear, and a lost
/// one costs nothing: the run itself is the record.
function announce(channel: Channel, topic: string, payload: unknown): void {
  void channel.publish(topic, payload).catch(() => undefined);
}

async function classifyTool(
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

async function listTools(ctx: Call): Promise<ToolSpec[]> {
  return readToolList(await ctx.channel.call("tools", "list", {}, { signal: ctx.signal }));
}

async function listSkills(ctx: Call): Promise<SkillSummary[]> {
  try {
    const reply = (await ctx.channel.call("skill", "list", {}, { signal: ctx.signal })) as {
      skills?: SkillSummary[];
    };
    return reply?.skills ?? [];
  } catch {
    return [];
  }
}

/// The policy is read so the prompt can state it, and a deployment without a
/// permission capability simply says nothing about approval.
async function approvalMode(ctx: Call, sessionId: string, cwd: string): Promise<string | null> {
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

let hooksAvailable = false;

/// The label a post-tool refusal carries once it becomes context: the engine
/// folds the reasons of several hooks into one, so the message names the event
/// they answered rather than any single hook.
const DENIED = "hook:PostToolUse";

/// The engine answers in the hook dialect while the loop consumes its own
/// decision shapes. This file is the only place that knows both, so every hook
/// field is mapped here and a field this seam has no use for is dropped rather
/// than handed on.
function asPreTool(outcome: HookOutcome): PreToolDecision {
  return {
    ...(outcome.decision === undefined ? {} : { decision: outcome.decision }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
  };
}

/// A refusal after the fact is read as a request to stop as well, since this
/// seam has no other way to say no; its reason rides along as context, so the
/// model learns why the round ended.
function asPostTool(outcome: HookOutcome): PostToolDecision {
  const context = [...(outcome.context ?? [])];
  if (outcome.decision === "deny" && outcome.reason !== undefined) context.push({ source: DENIED, text: outcome.reason });
  return {
    ...(context.length === 0 ? {} : { context }),
    ...(outcome.preventContinuation === true || outcome.decision === "deny" ? { halt: true } : {}),
  };
}

function asStop(outcome: HookOutcome): StopDecision {
  return {
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
    ...(outcome.steer === undefined ? {} : { steer: outcome.steer }),
  };
}

function hasOpinion(outcome: HookOutcome): boolean {
  return (
    outcome.decision !== undefined ||
    outcome.reason !== undefined ||
    outcome.context !== undefined ||
    outcome.preventContinuation !== undefined ||
    outcome.steer !== undefined
  );
}

/// A deployment without the engine has no hooks, and one that cannot answer
/// loses only its opinion, never the turn: a hook sits over a gate that already
/// fails closed, so it must never become the reason a run stops.
async function triggerHook(ctx: Call, event: HookEvent, payload: unknown): Promise<HookOutcome> {
  if (!hooksAvailable) return {};
  try {
    const reply = (await ctx.channel.call("hooks", "trigger", { event, payload }, { signal: ctx.signal })) as
      | HookOutcome
      | null;
    return reply ?? {};
  } catch (error) {
    ctx.channel.log("warn", `hooks.trigger ${event} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function seam<T>(
  ctx: Call,
  event: HookEvent,
  payload: unknown,
  map: (outcome: HookOutcome) => T,
): Promise<T | null> {
  const outcome = await triggerHook(ctx, event, payload);
  return hasOpinion(outcome) ? map(outcome) : null;
}

async function loadHistory(ctx: Call, sessionId: string, cwd: string | null): Promise<Message[]> {
  const reply = (await ctx.channel.call(
    "session",
    "load",
    { id: sessionId, cwd: cwd ?? "" },
    { signal: ctx.signal },
  )) as { messages?: Message[] };
  return Array.isArray(reply?.messages) ? reply.messages : [];
}

async function persist(
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

async function chatStream(
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

export const definition: Definition = {
  provides: [{ capability: "agent.loop", version: "1.3.0" }],
  configKeys: ["max_steps", "max_parallel_tools", "system", "thinking"],
  requires: [
    { capability: "api", version: "^1" },
    { capability: "tools", version: "^1" },
    { capability: "session", version: "^1" },
    { capability: "skill", version: "^1", optional: true },
    { capability: "permission", version: "^1", optional: true },
    { capability: "hooks", version: "^1", optional: true },
  ],

  setup(wiring) {
    settings = {
      max_steps:
        typeof wiring.config.max_steps === "number" && wiring.config.max_steps > 0
          ? wiring.config.max_steps
          : DEFAULTS.max_steps,
      max_parallel_tools:
        typeof wiring.config.max_parallel_tools === "number" && wiring.config.max_parallel_tools > 0
          ? wiring.config.max_parallel_tools
          : DEFAULTS.max_parallel_tools,
      system: typeof wiring.config.system === "string" ? wiring.config.system : DEFAULTS.system,
      thinking: readThinking(wiring.config.thinking),
    };
  },

  /// The hook engine is optional by design: a deployment without it simply has
  /// no hooks, and asking a capability nobody provides would keep this plugin
  /// from starting at all.
  start(wiring) {
    hooksAvailable = wiring.capabilities.hooks !== undefined;
    wiring.channel.log("info", `agent: hooks ${hooksAvailable ? "on" : "off"}`, { hooks: hooksAvailable });
  },

  methods: {
    async run(params, ctx) {
      const stream = ctx.stream;
      if (!stream) throw new CallError(-32602, "agent.loop.run is streaming: pass meta.stream");

      const sessionId = String(params?.session_id ?? "default");
      const cwd = typeof params?.cwd === "string" && params.cwd !== "" ? params.cwd : null;
      const input = typeof params?.input === "string" ? params.input : "";
      const origin = readOrigin(params?.origin);
      const sub = origin !== null;
      const system = readSystem(params?.system);
      const allow = readNames(params?.tools_allow, "tools_allow");
      const deny = readNames(params?.tools_deny, "tools_deny") ?? [];
      const maxSteps = readSteps(params?.max_steps, settings.max_steps);
      const identity = origin?.parent_session_id ?? sessionId;
      const setting: LevelSetting = sub
        ? { ...(active.get(identity) ?? { tools: true }) }
        : resolveLevel(settings.thinking, readLevel(params?.thinking));

      let prompt: PreToolDecision | null = null;
      if (!sub) {
        // Before the tools, the skills, the gate and the model: a refused prompt
        // costs a hook call and nothing else, and it is never written down.
        prompt = await seam(ctx, "UserPromptSubmit", { session_id: sessionId, cwd, input }, asPreTool);
        if (prompt?.decision === "deny") {
          stream.push({ type: "done", steps: 0, text: prompt.reason ?? "", reason: "refused" });
          return;
        }
      }

      const [available, skills, mode] = await Promise.all([
        listTools(ctx),
        sub ? Promise.resolve<SkillSummary[]>([]) : listSkills(ctx),
        approvalMode(ctx, identity, cwd ?? ""),
      ]);
      const allowed = (name: string): boolean => (allow === null || allow.includes(name)) && !deny.includes(name);
      const pool = setting.tools ? [...available] : [];
      if (!sub && setting.tools && skills.length > 0) pool.push(SKILL_TOOL);
      const tools = pool.filter((tool) => allowed(tool.name));
      const modelTools = tools.map(stripHostArgs);
      const child: SubagentRef | null =
        origin === null
          ? null
          : {
              subagent_id: sessionId,
              parent_session_id: origin.parent_session_id,
              parent_call_id: origin.parent_call_id,
              type: origin.type,
              description: origin.description,
            };

      // A subagent's calls are the parent's calls as far as the rest of the
      // deployment is concerned: the same session, the same `task` call, and a
      // label saying which subagent is asking.
      const host = (callId: string | null): HostValues => ({
        session_cwd: cwd,
        session_id: identity,
        call_id: origin === null ? callId : origin.parent_call_id,
        subagent: child === null ? null : { id: child.subagent_id, type: child.type, description: child.description },
      });
      const specOf = (name: string): ToolSpec | undefined => tools.find((tool) => tool.name === name);
      const argsOf = (call: ToolCall): unknown => injectHostArgs(specOf(call.name), call.args, host(call.id));
      const hooksFor = (invoked: ToolCall, step: number): Record<string, unknown> => ({
        session_id: identity,
        cwd,
        step,
        tool: invoked.name,
        args: argsOf(invoked),
        call_id: origin === null ? invoked.id : origin.parent_call_id,
        ...(child === null
          ? {}
          : { subagent: { id: child.subagent_id, type: child.type, description: child.description } }),
      });
      // The tool surface is closed at the seam as well as in the listing, so a
      // name the model invented is refused instead of hoped against.
      const refused = (name: string): PreToolDecision => ({
        decision: "deny",
        reason: sub
          ? `the ${name} tool is not available to this subagent`
          : `the ${name} tool is not available in this run`,
      });
      const announceSub = (topic: string, fields: Record<string, unknown>): void => {
        if (child === null) return;
        announce(ctx.channel, topic, { ...child, ...fields });
      };

      const history: Message[] = sub ? [] : await loadHistory(ctx, sessionId, cwd);
      if (input !== "") history.push({ role: "user", content: input });
      const first = history.find((message) => message.role === "user" && typeof message.content === "string");
      history.push(...sourcedMessages(prompt?.context ?? []));

      const title = origin !== null && origin.description !== "" ? origin.description : titleOf(first?.content);
      await persist(ctx, sessionId, cwd, history, title, origin);

      const messages: Message[] = [
        { role: "system", content: systemPrompt(system ?? settings.system, skills, cwd, mode) },
        ...history,
      ];

      announceSub("agent.subagent.started", {});
      if (!sub) active.set(sessionId, setting);
      const heartbeat = setInterval(() => stream.push({ type: "tick" }), 10_000);
      let closed = false;
      try {
        const outcome = await runLoop(
          {
            tools,
            max_steps: maxSteps,
            max_parallel: settings.max_parallel_tools,
            chat: (step) => chatStream(ctx, step.state.messages, modelTools, setting.model, step.signal, step.delta),
            callTool: (invoked, step) =>
              invoked.name === SKILL_TOOL.name
                ? ctx.channel.call(
                    "skill",
                    "load",
                    { name: (invoked.args as { name?: unknown }).name },
                    { signal: step.signal },
                  )
                : ctx.channel.call(
                    "tools",
                    "call",
                    { name: invoked.name, args: argsOf(invoked) },
                    { signal: step.signal },
                  ),
            classify: (invoked, step) =>
              invoked.name === SKILL_TOOL.name
                ? Promise.resolve(true)
                : classifyTool(ctx, specOf(invoked.name), invoked, host(invoked.id), step.signal),
            preTool: async (invoked, step) =>
              allowed(invoked.name)
                ? await seam(ctx, "PreToolUse", hooksFor(invoked, step.step), asPreTool)
                : refused(invoked.name),
            postTool: (invoked, outcome, step) =>
              seam(ctx, "PostToolUse", { ...hooksFor(invoked, step.step), ok: outcome.ok, output: outcome.output }, asPostTool),
            ...(sub
              ? {}
              : {
                  atStop: (state: LoopState) =>
                    seam(
                      ctx,
                      "Stop",
                      { session_id: sessionId, cwd, steps: state.step, stop_active: state.stopSteered },
                      asStop,
                    ),
                }),
          },
          messages,
          ctx.signal,
          (event: LoopEvent) => {
            stream.push(event);
            if (event.type === "step") announceSub("agent.subagent.step", { step: event.step });
            else if (event.type === "tool_call") {
              announceSub("agent.subagent.tool_call", { id: event.id, tool: event.tool, args: event.args });
            } else if (event.type === "tool_result") {
              announceSub("agent.subagent.tool_result", {
                id: event.id,
                tool: event.tool,
                ok: event.ok,
                output: event.output,
              });
            }
          },
        );
        await persist(ctx, sessionId, cwd, messages.slice(1), title, origin);
        announceSub("agent.subagent.finished", {
          steps: outcome.steps,
          reason: outcome.reason,
          ok: outcome.reason === "completed",
        });
        closed = true;
        stream.push({ type: "done", steps: outcome.steps, text: outcome.text, reason: outcome.reason });
      } finally {
        clearInterval(heartbeat);
        if (!sub) active.delete(sessionId);
        if (child !== null && !closed) announceSub("agent.subagent.finished", { ok: false, reason: "failed" });
      }
    },

    info() {
      return { levels: [...LEVELS], thinking: settings.thinking };
    },
  },

  async selfCheck() {
    const problems: string[] = [];

    let budget = 0;
    const stalled = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          budget += 1;
          return {
            role: "assistant",
            content: null,
            tool_calls: [{ id: `c${budget}`, function: { name: "echo", arguments: "{}" } }],
          };
        },
        callTool: async () => "ok",
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      () => {},
    );
    if (stalled.reason !== "max_steps") problems.push(`a stalled loop ended as ${stalled.reason}, expected max_steps`);
    if (stalled.steps !== 2) problems.push(`a stalled loop took ${stalled.steps} steps, expected 2`);
    if (budget !== 2) problems.push(`a stalled loop called the model ${budget} times, expected 2`);

    const thinking = readThinking({
      low: "deepseek-chat",
      medium: { model: "deepseek-reasoner", tools: false },
      nonsense: "ignored",
    });
    if (Object.keys(thinking).length !== 2) problems.push("unknown level names were kept");
    if (resolveLevel(thinking, "low").model !== "deepseek-chat") problems.push("a bare model name was not read");
    if (!resolveLevel(thinking, "low").tools) problems.push("a bare model name should keep tools on");
    if (resolveLevel(thinking, "medium").tools) problems.push("tools = false was ignored");
    if (resolveLevel(thinking, "high").model !== undefined) problems.push("an unset level invented a model");
    if (!resolveLevel(thinking, "high").tools) problems.push("an unset level should keep tools on");
    if (readLevel(undefined) !== "off") problems.push("the default level is not off");
    try {
      readLevel("deep");
      problems.push("readLevel accepted an unknown level");
    } catch {
    }

    if (titleOf("  a\n\nb  ") !== "a b") problems.push(`titleOf flattened to ${JSON.stringify(titleOf("  a\n\nb  "))}`);
    if (titleOf("x".repeat(40)) !== `${"x".repeat(30)}…`) problems.push("titleOf did not cut at 30 graphemes");
    if (titleOf(undefined) !== "") problems.push("titleOf invented a title");
    const family = titleOf("👨‍👩‍👧‍👦".repeat(40));
    if ([...segmenter.segment(family)].length > 31) problems.push("titleOf split a grapheme cluster");
    if (!family.endsWith("…")) problems.push("titleOf did not cut the long family line");

    if (systemPrompt("base", [], null, "ask")?.includes("approval: ask") !== true) {
      problems.push("the system prompt did not state the approval policy");
    }
    if (systemPrompt("base", [], null, null) !== "base") {
      problems.push("the system prompt invented an approval line with no policy");
    }

    const host: HostValues = { session_cwd: "E:\\proj", session_id: "s1", call_id: "c1", subagent: null };
    const pwsh: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [{ name: "workdir", source: "session_cwd" }],
    };
    if ((injectHostArgs(pwsh, { command: "ls" }, host) as { workdir?: string }).workdir !== "E:\\proj") {
      problems.push("the session workdir was not injected");
    }
    if ((injectHostArgs(pwsh, { command: "ls", workdir: "D:\\x" }, host) as { workdir?: string }).workdir !== "D:\\x") {
      problems.push("host injection overwrote the model's own workdir");
    }
    const other: ToolSpec = {
      name: "other",
      input_schema: { type: "object", properties: { a: { type: "string" } } },
    };
    if ((injectHostArgs(other, { a: 1 }, host) as { workdir?: unknown }).workdir !== undefined) {
      problems.push("host args were injected into a tool that declares none");
    }
    if (
      (injectHostArgs(pwsh, { command: "ls" }, { session_cwd: null, session_id: null, call_id: null, subagent: null }) as {
        workdir?: unknown;
      }).workdir !== undefined
    ) {
      problems.push("host args were injected without a session workdir");
    }
    const gate: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [
        { name: "workdir", source: "session_cwd" },
        { name: "session_id", source: "session_id" },
        { name: "call_id", source: "call_id" },
      ],
    };
    const injected = injectHostArgs(gate, { command: "ls" }, host) as {
      workdir?: string;
      session_id?: string;
      call_id?: string;
    };
    if (injected.session_id !== "s1" || injected.call_id !== "c1" || injected.workdir !== "E:\\proj") {
      problems.push(`the session and call identity were not injected: ${JSON.stringify(injected)}`);
    }
    if (hostValue("elsewhere", host) !== null) problems.push("an unknown host source invented a value");
    if ((stripHostArgs(pwsh) as { host_args?: unknown }).host_args !== undefined) {
      problems.push("host_args leaked into the model visible spec");
    }
    if (stripHostArgs(pwsh).name !== "pwsh") problems.push("stripHostArgs dropped the tool name");

    const subTool: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [
        { name: "session_id", source: "session_id" },
        { name: "call_id", source: "call_id" },
        { name: "subagent", source: "subagent" },
      ],
    };
    const carried = injectHostArgs(subTool, { command: "ls" }, {
      session_cwd: "E:\\proj",
      session_id: "p1",
      call_id: "c1",
      subagent: { id: "sub-3f2a", type: "explore", description: "look" },
    } as HostValues) as { subagent?: { id?: string; type?: string } };
    if (carried.subagent?.id !== "sub-3f2a" || carried.subagent.type !== "explore") {
      problems.push(`the subagent identity was not injected: ${JSON.stringify(carried)}`);
    }
    if ((injectHostArgs(subTool, { command: "ls" }, host) as { subagent?: unknown }).subagent !== undefined) {
      problems.push("a parent's call invented a subagent identity");
    }

    const defaults = readOrigin({ parent_session_id: "p1" });
    if (defaults?.type !== "general" || defaults.description !== "") problems.push("origin defaults drifted");
    if (readOrigin(undefined) !== null) problems.push("an absent origin invented a subagent");

    const published: Array<{ topic: string; payload: Record<string, any> }> = [];
    const calls: Array<{ capability: string; method: string; params: any }> = [];
    const saves: Array<Record<string, any>> = [];
    const listed: ToolSpec[] = [
      { name: "read", description: "read a file" },
      { name: "write", description: "write a file" },
      { name: "task", description: "ask another agent" },
    ];
    const scripted = (content: string, tool?: string): Message => ({
      role: "assistant",
      content: tool === undefined ? content : null,
      ...(tool === undefined ? {} : { tool_calls: [{ id: `t-${tool}`, function: { name: tool, arguments: "{}" } }] }),
    });
    const harness = (script: readonly Message[], gate?: Promise<void>) => {
      const chat: Array<{ messages: Message[]; tools?: ToolSpec[]; model?: string }> = [];
      const events: LoopEvent[] = [];
      const heard: Array<{ capability: string; method: string; params: any }> = [];
      const sent: typeof published = [];
      const queue = [...script];
      const channel = {
        call: async (capability: string, method: string, params: any) => {
          const record = { capability, method, params };
          calls.push(record);
          heard.push(record);
          if (capability === "tools" && method === "list") return { tools: listed };
          if (capability === "skill" && method === "list") return { skills: [{ name: "s", description: "d" }] };
          if (capability === "permission" && method === "policy") return { mode: "ask" };
          if (capability === "session" && method === "load") return { messages: [{ role: "user", content: "earlier" }] };
          if (capability === "session" && method === "save") {
            saves.push(params);
            return {};
          }
          if (capability === "tools" && method === "classify") return { safe: true };
          if (capability === "tools" && method === "call") return "tool output";
          throw new Error(`unexpected call ${capability}/${method}`);
        },
        stream: async (_capability: string, _method: string, params: any) => {
          chat.push(params);
          if (gate !== undefined) await gate;
          const message = queue.shift() ?? { role: "assistant", content: "done" };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "message", message };
            },
          };
        },
        publish: async (topic: string, payload: unknown) => {
          const record = { topic, payload: payload as Record<string, any> };
          published.push(record);
          sent.push(record);
        },
        log: () => {},
      };
      const call = {
        channel,
        config: {},
        capabilities: {},
        capability: "agent.loop",
        method: "run",
        caller: "tool-subagent",
        signal: new AbortController().signal,
        stream: { push: (event: LoopEvent) => events.push(event) },
      } as unknown as Call;
      return { call, chat, events, heard, sent };
    };
    const surfaced = (chat: Array<{ tools?: ToolSpec[] }>): string =>
      (chat[0]?.tools ?? []).map((tool) => tool.name).join(",");
    const run = (params: Record<string, unknown>, script: readonly Message[], gate?: Promise<void>) => {
      const made = harness(script, gate);
      return { ...made, done: Promise.resolve(definition.methods.run?.(params, made.call)) };
    };

    const explore = run(
      {
        session_id: "sub-a",
        cwd: "E:\\proj",
        input: "find where the loader is registered",
        origin: { parent_session_id: "p1", parent_call_id: "c1", type: "explore", description: "look at the loader" },
        system: "you are an explore subagent",
        tools_allow: ["read"],
        tools_deny: ["task"],
        max_steps: 3,
      },
      [scripted("", "write"), scripted("the loader is in graph.rs")],
    );
    await explore.done;
    if (explore.chat.length !== 2) problems.push(`the subagent ran ${explore.chat.length} steps, expected 2`);
    if (surfaced(explore.chat) !== "read") problems.push(`the explore subagent listed ${surfaced(explore.chat)}`);
    const opening = explore.chat[0]?.messages ?? [];
    if (opening[1]?.role !== "user" || opening[1]?.content !== "find where the loader is registered") {
      problems.push(`the subagent opened with ${JSON.stringify(opening.slice(0, 3))}`);
    }
    const brief = explore.chat[0]?.messages[0]?.content ?? "";
    if (!brief.startsWith("you are an explore subagent")) {
      problems.push("the subagent kept the deployment system prompt over its own");
    }
    if (!brief.includes("working directory: E:\\proj") || !brief.includes("approval: ask")) {
      problems.push(`the subagent prompt lost its place and policy: ${JSON.stringify(brief)}`);
    }
    if (explore.heard.some((item) => item.capability === "session" && item.method === "load")) {
      problems.push("the subagent read the history it was meant to start without");
    }
    if (explore.heard.some((item) => item.capability === "skill")) problems.push("a subagent was offered skills");
    if (explore.heard.some((item) => item.capability === "tools" && item.method === "call")) {
      problems.push("a tool the subagent does not have was still run");
    }
    const blocked = explore.events.find((event) => event.type === "tool_result") as
      | { ok?: boolean; output?: unknown }
      | undefined;
    if (blocked === undefined || blocked.ok !== false || !String(blocked.output).includes("not available to this subagent")) {
      problems.push(`a tool outside the subagent surface came out as ${JSON.stringify(blocked)}`);
    }
    const saved = saves.at(-1) ?? null;
    if (saved?.parent?.id !== "p1" || saved.parent.call_id !== "c1" || saved.parent.type !== "explore") {
      problems.push(`the subagent session was saved as ${JSON.stringify(saved?.parent)}`);
    }
    if (saved?.title !== "look at the loader") problems.push(`the subagent session was titled ${JSON.stringify(saved?.title)}`);
    const topics = explore.sent.map((item) => item.topic).join(",");
    if (
      topics !==
      "agent.subagent.started,agent.subagent.step,agent.subagent.tool_call,agent.subagent.tool_result," +
        "agent.subagent.step,agent.subagent.finished"
    ) {
      problems.push(`the subagent published ${JSON.stringify(topics)}`);
    }
    const head = explore.sent[0]?.payload ?? {};
    if (head.subagent_id !== "sub-a" || head.parent_session_id !== "p1" || head.parent_call_id !== "c1") {
      problems.push(`the first subagent event carried ${JSON.stringify(head)}`);
    }
    if (explore.sent.some((item) => item.payload.description !== "look at the loader")) {
      problems.push("a subagent event lost the description");
    }

    const general = run(
      {
        session_id: "sub-b",
        cwd: "E:\\proj",
        input: "summarise the tree",
        origin: { parent_session_id: "p1", parent_call_id: "c2", type: "general", description: "summarise" },
        tools_deny: ["task"],
      },
      [scripted("", "task"), scripted("done")],
    );
    await general.done;
    if (surfaced(general.chat) !== "read,write") problems.push(`the general subagent listed ${surfaced(general.chat)}`);
    if (general.heard.some((item) => item.capability === "tools" && item.method === "call")) {
      problems.push("the tool that spawns subagents ran inside a subagent");
    }

    definition.setup?.({ channel: undefined, config: { thinking: { low: "m-low" } }, capabilities: {} } as unknown as Wiring);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parent = run({ session_id: "p1", cwd: "E:\\proj", input: "hi", thinking: "low" }, [scripted("parent done")], held);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (surfaced(parent.chat) !== "read,write,task,skill") {
      problems.push(`the parent listed ${surfaced(parent.chat)}`);
    }
    const inherited = run(
      {
        session_id: "sub-c",
        cwd: "E:\\proj",
        input: "child",
        origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
      },
      [scripted("child done")],
    );
    await inherited.done;
    if (inherited.chat[0]?.model !== "m-low") {
      problems.push(`a subagent ran on model ${JSON.stringify(inherited.chat[0]?.model)}, expected the parent's`);
    }
    release();
    await parent.done;
    if (!parent.heard.some((item) => item.capability === "session" && item.method === "load")) {
      problems.push("the parent skipped its own history");
    }
    const orphan = run(
      {
        session_id: "sub-d",
        cwd: "E:\\proj",
        input: "child",
        origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
      },
      [scripted("child done")],
    );
    await orphan.done;
    if (orphan.chat[0]?.model !== undefined) {
      problems.push(`a subagent outlived its parent's level: ${JSON.stringify(orphan.chat[0]?.model)}`);
    }

    for (const [bad, why] of [
      [{ session_id: "s", origin: {} }, "an origin without a parent"],
      [{ session_id: "s", origin: { parent_session_id: "" } }, "a blank parent session"],
      [{ session_id: "s", origin: 7 }, "a non-object origin"],
      [{ session_id: "s", tools_allow: "read" }, "a non-array allow list"],
      [{ session_id: "s", tools_allow: ["read", 7] }, "an allow list with a non-name"],
      [{ session_id: "s", max_steps: 0 }, "a zero step budget"],
      [{ session_id: "s", system: 7 }, "a non-string system prompt"],
    ] as Array<[Record<string, unknown>, string]>) {
      try {
        await run(bad, []).done;
        problems.push(`run accepted ${why}`);
      } catch {
      }
    }

    if (hasOpinion({})) problems.push("an empty hook outcome counted as an opinion");
    if (!hasOpinion({ context: [] })) problems.push("a bare context is still an opinion");
    if ("steer" in asPreTool({ decision: "deny", reason: "no", steer: "again" })) {
      problems.push("a pre-tool decision kept a field its seam does not consume");
    }
    const refused = asPostTool({ decision: "deny", reason: "no" });
    if (refused.halt !== true) problems.push("a post-tool refusal did not end the round");
    if ((refused.context ?? []).map((note) => `${note.source}:${note.text}`).join(",") !== `${DENIED}:no`) {
      problems.push(`a post-tool refusal came out as ${JSON.stringify(refused.context)}`);
    }
    const steering = asStop({ steer: "again", context: [{ source: "hook:x", text: "t" }] });
    if (steering.steer !== "again" || steering.context?.length !== 1) problems.push("a stop decision drifted");

    let engine = 0;
    const logged: string[] = [];
    const fakeEngine = (reply: unknown, fail = false): Wiring =>
      ({
        config: {},
        capabilities: { hooks: { plugin: "hooks", version: "1.0.0" } },
        channel: {
          call: async () => {
            engine += 1;
            if (fail) throw new Error("engine down");
            return reply;
          },
          log: (level: string, message: string) => logged.push(`${level}: ${message}`),
        },
      }) as unknown as Wiring;
    const engineOff = { config: {}, capabilities: {}, channel: fakeEngine(null).channel } as unknown as Wiring;

    await definition.start?.(engineOff);
    if (Object.keys(await triggerHook(engineOff as unknown as Call, "Stop", {})).length !== 0) {
      problems.push("an opinion was invented while the engine was off");
    }
    if (engine !== 0) problems.push("the engine was called while it was off");

    await definition.start?.(fakeEngine({ decision: "deny", reason: "no" }));
    const heard = await triggerHook(fakeEngine({ decision: "deny", reason: "no" }) as unknown as Call, "PreToolUse", {});
    if (heard.reason !== "no" || heard.decision !== "deny") {
      problems.push(`the engine's answer did not reach the seam: ${JSON.stringify(heard)}`);
    }
    if (Object.keys(await triggerHook(fakeEngine(null, true) as unknown as Call, "Stop", {})).length !== 0) {
      problems.push("a failed engine call invented an opinion");
    }
    if (!logged.some((line) => line.startsWith("warn: "))) problems.push("a failed engine call was not logged");
    await definition.start?.(engineOff);
    if (hooksAvailable) problems.push("the seam stayed on once the capability went away");

    const info = definition.methods.info?.({}, {} as Call) as { levels?: string[]; thinking?: unknown } | undefined;
    if (info?.levels?.join(",") !== LEVELS.join(",")) problems.push(`info returned ${JSON.stringify(info)}`);

    let asked = 0;
    const deltas: string[] = [];
    const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 4,
        chat: async (step) => {
          asked += 1;
          if (asked === 1) {
            step.delta({ text: "→" });
            step.delta({ reasoning: "plan" });
            return {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"n":1}' } }],
            };
          }
          step.delta({ text: "done" });
          return { role: "assistant", content: "done" };
        },
        callTool: async (call) => ({ name: call.name, args: call.args }),
      },
      messages,
      new AbortController().signal,
      (event) => {
        if (event.type === "text") deltas.push(event.text);
      },
    );
    if (outcome.text !== "done") problems.push(`loop text ${JSON.stringify(outcome.text)}`);
    if (outcome.steps !== 2) problems.push(`loop took ${outcome.steps} steps, expected 2`);
    if (outcome.reason !== "completed") problems.push(`loop ended as ${outcome.reason}, expected completed`);
    if (!messages.some((message) => message.role === "tool")) problems.push("loop never wrote a tool result back");
    if (deltas.join("") !== "→done") problems.push(`deltas came out as ${JSON.stringify(deltas)}`);
    return problems;
  },
};

runPlugin(definition);
