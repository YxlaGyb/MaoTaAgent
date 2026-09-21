#!/usr/bin/env node
import { CallError, runPlugin, type Call, type Definition, type Wiring } from "@maota/plugin-kit";
import {
  runLoop,
  sourcedMessages,
  type ChatDelta,
  type LoopEvent,
  type Message,
  type PostToolDecision,
  type PreToolDecision,
  type StopDecision,
  type ToolCall,
  type ToolSpec,
} from "@maota/agent-loop";
import type { HookEvent, HookOutcome } from "@maota/hook-protocol";
import { systemPrompt, type SkillSummary } from "./prompt.ts";
import { SKILL_TOOL, hostValue, injectHostArgs, readToolList, stripHostArgs, type HostValues } from "./tools.ts";

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
): Promise<void> {
  await ctx.channel.call(
    "session",
    "save",
    { id: sessionId, cwd: cwd ?? "", title, messages },
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
  provides: [{ capability: "agent.loop", version: "1.2.0" }],
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
      const level = readLevel(params?.thinking);
      const setting = resolveLevel(settings.thinking, level);
      const input = typeof params?.input === "string" ? params.input : "";

      // Before the tools, the skills, the gate and the model: a refused prompt
      // costs a hook call and nothing else, and it is never written down.
      const prompt = await seam(ctx, "UserPromptSubmit", { session_id: sessionId, cwd, input }, asPreTool);
      if (prompt?.decision === "deny") {
        stream.push({ type: "done", steps: 0, text: prompt.reason ?? "", reason: "refused" });
        return;
      }

      const [available, skills, mode] = await Promise.all([
        listTools(ctx),
        listSkills(ctx),
        approvalMode(ctx, sessionId, cwd ?? ""),
      ]);
      const tools = setting.tools ? available : [];
      if (setting.tools && skills.length > 0) tools.push(SKILL_TOOL);
      const modelTools = tools.map(stripHostArgs);
      const host = (callId: string | null): HostValues => ({
        session_cwd: cwd,
        session_id: sessionId,
        call_id: callId,
      });
      const specOf = (name: string): ToolSpec | undefined => tools.find((tool) => tool.name === name);
      const argsOf = (call: ToolCall): unknown => injectHostArgs(specOf(call.name), call.args, host(call.id));

      const history = await loadHistory(ctx, sessionId, cwd);
      if (input !== "") history.push({ role: "user", content: input });
      const first = history.find((message) => message.role === "user" && typeof message.content === "string");
      history.push(...sourcedMessages(prompt?.context ?? []));

      await persist(ctx, sessionId, cwd, history, titleOf(first?.content));

      const messages: Message[] = [
        { role: "system", content: systemPrompt(settings.system, skills, cwd, mode) },
        ...history,
      ];

      const heartbeat = setInterval(() => stream.push({ type: "tick" }), 10_000);
      try {
        const outcome = await runLoop(
          {
            tools,
            max_steps: settings.max_steps,
            max_parallel: settings.max_parallel_tools,
            chat: (step) =>
              chatStream(ctx, step.state.messages, modelTools, setting.model, step.signal, step.delta),
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
            preTool: (invoked, step) =>
              seam(
                ctx,
                "PreToolUse",
                {
                  session_id: sessionId,
                  cwd,
                  step: step.step,
                  tool: invoked.name,
                  args: argsOf(invoked),
                  call_id: invoked.id,
                },
                asPreTool,
              ),
            postTool: (invoked, outcome, step) =>
              seam(
                ctx,
                "PostToolUse",
                {
                  session_id: sessionId,
                  cwd,
                  step: step.step,
                  tool: invoked.name,
                  args: argsOf(invoked),
                  call_id: invoked.id,
                  ok: outcome.ok,
                  output: outcome.output,
                },
                asPostTool,
              ),
            atStop: (state) =>
              seam(
                ctx,
                "Stop",
                { session_id: sessionId, cwd, steps: state.step, stop_active: state.stopSteered },
                asStop,
              ),
          },
          messages,
          ctx.signal,
          (event: LoopEvent) => stream.push(event),
        );
        await persist(ctx, sessionId, cwd, messages.slice(1), titleOf(first?.content));
        stream.push({ type: "done", steps: outcome.steps, text: outcome.text, reason: outcome.reason });
      } finally {
        clearInterval(heartbeat);
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

    const host: HostValues = { session_cwd: "E:\\proj", session_id: "s1", call_id: "c1" };
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
      (injectHostArgs(pwsh, { command: "ls" }, { session_cwd: null, session_id: null, call_id: null }) as {
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
