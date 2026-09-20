#!/usr/bin/env node
import { CallError, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import {
  runLoop,
  type ChatDelta,
  type LoopEvent,
  type Message,
  type ToolCall,
  type ToolSpec,
} from "@maota/agent-loop";
import { systemPrompt, type SkillSummary } from "./prompt.ts";
import { SKILL_TOOL, injectHostArgs, readToolList, stripHostArgs, type HostValues } from "./tools.ts";

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
  provides: [{ capability: "agent.loop", version: "1.1.0" }],
  configKeys: ["max_steps", "max_parallel_tools", "system", "thinking"],
  requires: [
    { capability: "api", version: "^1" },
    { capability: "tools", version: "^1" },
    { capability: "session", version: "^1" },
    { capability: "skill", version: "^1", optional: true },
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

  methods: {
    async run(params, ctx) {
      const stream = ctx.stream;
      if (!stream) throw new CallError(-32602, "agent.loop.run is streaming: pass meta.stream");

      const sessionId = String(params?.session_id ?? "default");
      const cwd = typeof params?.cwd === "string" && params.cwd !== "" ? params.cwd : null;
      const level = readLevel(params?.thinking);
      const setting = resolveLevel(settings.thinking, level);
      const input = typeof params?.input === "string" ? params.input : "";

      const [available, skills] = await Promise.all([listTools(ctx), listSkills(ctx)]);
      const tools = setting.tools ? available : [];
      if (setting.tools && skills.length > 0) tools.push(SKILL_TOOL);
      const modelTools = tools.map(stripHostArgs);
      const host: HostValues = { session_cwd: cwd };
      const specOf = (name: string): ToolSpec | undefined => tools.find((tool) => tool.name === name);

      const history = await loadHistory(ctx, sessionId, cwd);
      if (input !== "") history.push({ role: "user", content: input });
      const first = history.find((message) => message.role === "user" && typeof message.content === "string");

      await persist(ctx, sessionId, cwd, history, titleOf(first?.content));

      const messages: Message[] = [
        { role: "system", content: systemPrompt(settings.system, skills, cwd) },
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
                    { name: invoked.name, args: injectHostArgs(specOf(invoked.name), invoked.args, host) },
                    { signal: step.signal },
                  ),
            classify: (invoked, step) =>
              invoked.name === SKILL_TOOL.name
                ? Promise.resolve(true)
                : classifyTool(ctx, specOf(invoked.name), invoked, host, step.signal),
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

    const host: HostValues = { session_cwd: "E:\\proj" };
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
    if ((injectHostArgs(pwsh, { command: "ls" }, { session_cwd: null }) as { workdir?: unknown }).workdir !== undefined) {
      problems.push("host args were injected without a session workdir");
    }
    if ((stripHostArgs(pwsh) as { host_args?: unknown }).host_args !== undefined) {
      problems.push("host_args leaked into the model visible spec");
    }
    if (stripHostArgs(pwsh).name !== "pwsh") problems.push("stripHostArgs dropped the tool name");

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
