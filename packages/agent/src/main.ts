#!/usr/bin/env node
// agent: 一轮对话就是一条流。能力 agent.loop，方法 run。
import { CallError, runPlugin, type Call, type Definition } from "../../plugin-kit/src/index.ts";
import { runLoop, type LoopEvent } from "./loop.ts";
import { systemPrompt, type SkillSummary } from "./prompt.ts";
import { Sessions, type Message } from "./session.ts";
import { SKILL_TOOL, readToolList, type ToolSpec } from "./tools.ts";

const DEFAULTS = {
  max_steps: 8,
  system:
    "You are MaoTa, a coding agent. Use the tools you are given, one step at a time, and answer in the user's language.",
};

let settings = { ...DEFAULTS };
const sessions = new Sessions();

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
    return []; // 技能是可选的: 没有技能也要能对话
  }
}

export const definition: Definition = {
  provides: [{ capability: "agent.loop", version: "1.0.0" }],
  configKeys: ["max_steps", "system"],
  requires: [
    { capability: "api", version: "^1" },
    { capability: "tools", version: "^1" },
    { capability: "skill", version: "^1", optional: true },
  ],

  setup(wiring) {
    settings = {
      max_steps:
        typeof wiring.config.max_steps === "number" && wiring.config.max_steps > 0
          ? wiring.config.max_steps
          : DEFAULTS.max_steps,
      system: typeof wiring.config.system === "string" ? wiring.config.system : DEFAULTS.system,
    };
  },

  methods: {
    async run(params, ctx) {
      const stream = ctx.stream;
      if (!stream) throw new CallError(-32602, "agent.loop.run is streaming: pass meta.stream");

      const sessionId = String(params?.session_id ?? "default");
      if (params?.reset === true) sessions.reset(sessionId);
      const history = sessions.get(sessionId);
      const input = typeof params?.input === "string" ? params.input : "";
      if (input !== "") history.push({ role: "user", content: input });

      const [tools, skills] = await Promise.all([listTools(ctx), listSkills(ctx)]);
      if (skills.length > 0) tools.push(SKILL_TOOL);
      const messages: Message[] = [{ role: "system", content: systemPrompt(settings.system, skills) }, ...history];

      // 模型想得久没关系，但这条流不能安静超过 stream_idle_timeout_ms（默认 30s）。
      const heartbeat = setInterval(() => stream.push({ type: "tick" }), 10_000);
      try {
        const outcome = await runLoop(
          {
            tools,
            max_steps: settings.max_steps,
            chat: async (asked, available, signal) => {
              const reply = (await ctx.channel.call(
                "api",
                "chat",
                { messages: asked, tools: available },
                { signal },
              )) as { message?: Message };
              if (!reply?.message) throw new CallError(-32603, "api returned no message");
              return reply.message;
            },
            callTool: (name, args, signal) =>
              name === SKILL_TOOL.name
                ? ctx.channel.call("skill", "load", { name: (args as { name?: unknown }).name }, { signal })
                : ctx.channel.call("tools", "call", { name, args }, { signal }),
          },
          messages,
          ctx.signal,
          (event: LoopEvent) => stream.push(event),
        );
        sessions.set(sessionId, messages.slice(1));
        stream.push({ type: "done", steps: outcome.steps, text: outcome.text });
      } finally {
        clearInterval(heartbeat);
      }
    },
  },

  async selfCheck() {
    // 不接内核也能跑: 用一个假模型确认"要工具 → 跑工具 → 再要一次 → 收口"这条链没断。
    const problems: string[] = [];
    let asked = 0;
    const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 4,
        chat: async () => {
          asked += 1;
          return asked === 1
            ? {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"n":1}' } }],
              }
            : { role: "assistant", content: "done" };
        },
        callTool: async (name, args) => ({ name, args }),
      },
      messages,
      new AbortController().signal,
      () => {},
    );
    if (outcome.text !== "done") problems.push(`loop text ${JSON.stringify(outcome.text)}`);
    if (outcome.steps !== 2) problems.push(`loop took ${outcome.steps} steps, expected 2`);
    if (!messages.some((message) => message.role === "tool")) problems.push("loop never wrote a tool result back");
    return problems;
  },
};

runPlugin(definition);
