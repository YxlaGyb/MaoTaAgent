#!/usr/bin/env node
// api: 模型的入口。能力 api，方法 chat。两种后端: openai（任何 OpenAI 兼容网关）+ scripted（离线脚本）。
import { runPlugin, type Definition } from "../../plugin-kit/src/index.ts";
import { readChat, type ChatReply } from "./messages.ts";
import { asOpenAITools, chat as openaiChat, type Gateway } from "./openai.ts";
import { scriptedChat, type ScriptStep } from "./scripted.ts";

interface Settings {
  backend: "openai" | "scripted";
  model: string;
  key_env: string;
  script: ScriptStep[];
}

let settings: Settings = { backend: "openai", model: "gpt-4o-mini", key_env: "OPENAI_API_KEY", script: [] };
let gateway: Gateway = { base_url: "https://api.openai.com/v1", api_key: "" };
/** scripted 后端的进度: 跨调用往前走，这样"第一轮要工具、第二轮收口"才成立。 */
let step = 0;

export const definition: Definition = {
  provides: [{ capability: "api", version: "1.0.0" }],
  configKeys: ["backend", "model", "base_url", "api_key", "api_key_env", "script"],

  setup(wiring) {
    const config = wiring.config;
    const key_env = typeof config.api_key_env === "string" ? config.api_key_env : "OPENAI_API_KEY";
    settings = {
      backend: config.backend === "scripted" ? "scripted" : "openai",
      model: typeof config.model === "string" ? config.model : "gpt-4o-mini",
      key_env,
      script: Array.isArray(config.script) ? (config.script as ScriptStep[]) : [],
    };
    step = 0;
    gateway = {
      base_url: typeof config.base_url === "string" ? config.base_url : "https://api.openai.com/v1",
      api_key: typeof config.api_key === "string" ? config.api_key : (process.env[key_env] ?? ""),
    };
    // 拿不到钥匙就别装能干活 —— 宁可启动失败，也不要每轮对话都报 401。
    if (settings.backend === "openai" && gateway.api_key === "") {
      throw new Error(`no API key: set ${key_env}, or put api_key in [plugins.<id>.config]`);
    }
  },

  methods: {
    async chat(params, ctx) {
      const request = readChat(params, settings.model);
      const reply: ChatReply =
        settings.backend === "scripted"
          ? scriptedChat(settings.script, step++)
          : await openaiChat(gateway, request, ctx.signal);
      return { backend: settings.backend, model: request.model, ...reply };
    },
  },

  selfCheck() {
    const problems: string[] = [];
    const call = scriptedChat([{ tool: "shell", args: { command: "echo hi" } }], 0).message
      .tool_calls?.[0] as { function?: { name?: string; arguments?: string } } | undefined;
    if (call?.function?.name !== "shell") problems.push(`scripted tool call: ${JSON.stringify(call)}`);
    if (call?.function?.arguments !== '{"command":"echo hi"}') {
      problems.push(`scripted tool arguments: ${JSON.stringify(call?.function?.arguments)}`);
    }
    if (scriptedChat([{ text: "done" }], 0).message.content !== "done") problems.push("scripted text step is wrong");
    const wrapped = asOpenAITools([{ name: "shell", description: "d", input_schema: { type: "object" } }])[0] as {
      type?: string;
      function?: { name?: string; parameters?: unknown };
    };
    if (wrapped?.type !== "function" || wrapped.function?.name !== "shell") {
      problems.push(`tool spec not wrapped for the wire: ${JSON.stringify(wrapped)}`);
    }
    try {
      readChat({ messages: [] }, "m");
      problems.push("readChat accepted an empty message list");
    } catch {
      // 要的就是这个
    }
    return problems;
  },
};

runPlugin(definition);
