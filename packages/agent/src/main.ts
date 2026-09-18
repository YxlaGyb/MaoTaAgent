#!/usr/bin/env node
import { CallError, runPlugin, type Call, type Definition } from "../../plugin-kit/src/index.ts";
import { runLoop, type ChatDelta, type LoopEvent } from "./loop.ts";
import { systemPrompt, type SkillSummary } from "./prompt.ts";
import type { Message } from "./session.ts";
import { SKILL_TOOL, injectCwd, readToolList, type ToolSpec } from "./tools.ts";

export const LEVELS = ["off", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export interface LevelSetting {
  model?: string;
  tools: boolean;
}

const DEFAULTS = {
  max_steps: 8,
  system:
    "You are MaoTa, a coding agent. Use the tools you are given, one step at a time, and answer in the user's language.",
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
  emit: (delta: ChatDelta) => void,
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
    if (event?.type === "delta" && typeof event.text === "string") emit({ text: event.text });
    else if (event?.type === "reasoning" && typeof event.text === "string") emit({ reasoning: event.text });
    else if (event?.type === "message" && event.message) final = event.message;
  }
  if (!final) {
    if (signal.aborted) throw new CallError(-32013, "cancelled");
    throw new CallError(-32603, "api returned no message");
  }
  return final;
}

export const definition: Definition = {
  provides: [{ capability: "agent.loop", version: "1.0.0" }],
  configKeys: ["max_steps", "system", "thinking"],
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
            chat: (asked, available, signal, emit) =>
              chatStream(ctx, asked, available, setting.model, signal, emit),
            callTool: (name, args, signal) =>
              name === SKILL_TOOL.name
                ? ctx.channel.call("skill", "load", { name: (args as { name?: unknown }).name }, { signal })
                : ctx.channel.call(
                    "tools",
                    "call",
                    { name, args: injectCwd(tools.find((tool) => tool.name === name), args, cwd) },
                    { signal },
                  ),
          },
          messages,
          ctx.signal,
          (event: LoopEvent) => stream.push(event),
        );
        await persist(ctx, sessionId, cwd, messages.slice(1), titleOf(first?.content));
        stream.push({ type: "done", steps: outcome.steps, text: outcome.text });
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

    const shell: ToolSpec = {
      name: "shell",
      input_schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } } },
    };
    if ((injectCwd(shell, { command: "ls" }, "E:\\proj") as { cwd?: string }).cwd !== "E:\\proj") {
      problems.push("cwd was not injected");
    }
    if ((injectCwd(shell, { command: "ls", cwd: "D:\\x" }, "E:\\proj") as { cwd?: string }).cwd !== "D:\\x") {
      problems.push("cwd injection overwrote the model's own cwd");
    }
    const other: ToolSpec = { name: "other", input_schema: { type: "object", properties: { a: { type: "string" } } } };
    if ((injectCwd(other, { a: 1 }, "E:\\proj") as { cwd?: unknown }).cwd !== undefined) {
      problems.push("cwd was injected into a tool that has no such parameter");
    }
    if ((injectCwd(shell, { command: "ls" }, null) as { cwd?: unknown }).cwd !== undefined) {
      problems.push("cwd was injected without a session workdir");
    }

    const info = definition.methods.info?.({}, {} as Call) as { levels?: string[]; thinking?: unknown } | undefined;
    if (info?.levels?.join(",") !== LEVELS.join(",")) problems.push(`info returned ${JSON.stringify(info)}`);

    let asked = 0;
    const deltas: string[] = [];
    const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 4,
        chat: async (_asked, _available, _signal, emit) => {
          asked += 1;
          if (asked === 1) {
            emit({ text: "→" });
            emit({ reasoning: "plan" });
            return {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"n":1}' } }],
            };
          }
          emit({ text: "done" });
          return { role: "assistant", content: "done" };
        },
        callTool: async (name, args) => ({ name, args }),
      },
      messages,
      new AbortController().signal,
      (event) => {
        if (event.type === "text") deltas.push(event.text);
      },
    );
    if (outcome.text !== "done") problems.push(`loop text ${JSON.stringify(outcome.text)}`);
    if (outcome.steps !== 2) problems.push(`loop took ${outcome.steps} steps, expected 2`);
    if (!messages.some((message) => message.role === "tool")) problems.push("loop never wrote a tool result back");
    if (deltas.join("") !== "→done") problems.push(`deltas came out as ${JSON.stringify(deltas)}`);
    return problems;
  },
};

runPlugin(definition);
