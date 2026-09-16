#!/usr/bin/env node
// tools: 工具目录。模型看的是工具名，路由要的是能力 id —— 这一层把它们对上。
import { CallError, runPlugin, type Definition } from "../../plugin-kit/src/index.ts";
import { discover, type ToolRoute } from "./registry.ts";

let tools = new Map<string, ToolRoute>();

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const definition: Definition = {
  provides: [{ capability: "tools", version: "1.0.0" }],
  configKeys: [],

  start(wiring) {
    tools = discover(wiring.capabilities);
    wiring.channel.log("info", `tools: ${[...tools.keys()].join(", ") || "(none)"}`, { count: tools.size });
  },

  methods: {
    async list(_params, ctx) {
      const listed: unknown[] = [];
      for (const tool of tools.values()) {
        try {
          const spec = await ctx.channel.call(tool.capability, "describe", {}, { signal: ctx.signal });
          listed.push({ ...(spec as Record<string, unknown>), capability: tool.capability });
        } catch (error) {
          // 一个坏工具不该让整张表消失: 记一条，跳过。
          ctx.channel.log("warn", `tool ${tool.name} describe failed`, { error: message(error) });
        }
      }
      return { tools: listed };
    },

    async call(params, ctx) {
      const name = String(params?.name ?? "");
      const tool = tools.get(name);
      if (!tool) throw new CallError(-32602, `no such tool: ${name}`);
      const result = await ctx.channel.call(tool.capability, "run", params?.args ?? {}, { signal: ctx.signal });
      return { tool: name, capability: tool.capability, result };
    },
  },

  selfCheck() {
    const problems: string[] = [];
    const found = discover({
      "tool.shell": { plugin: "shell", version: "1.0.0" },
      api: { plugin: "api", version: "1.0.0" },
    });
    if (found.size !== 1) problems.push(`discover picked ${found.size} tools, expected 1`);
    if (!found.has("shell")) problems.push("discover lost tool.shell");
    return problems;
  },
};

runPlugin(definition);
