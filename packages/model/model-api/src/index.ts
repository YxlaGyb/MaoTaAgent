#!/usr/bin/env node
import { CallError, isPluginEntry, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import type { AdapterChatRequest, DiscoveredModel, ModelStreamChunk } from "@maota/model-protocol";

function request(params: AdapterChatRequest): Record<string, unknown> {
  return {
    model: params.model.model,
    messages: params.messages,
    ...(params.tools === undefined ? {} : { tools: params.tools }),
    ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    ...(params.max_tokens === undefined ? {} : { max_tokens: params.max_tokens }),
    ...(params.session === undefined ? {} : { session: params.session }),
  };
}

async function chat(params: AdapterChatRequest, ctx: Call): Promise<void> {
  if (ctx.stream === undefined) throw new CallError(-32602, "model adapter chat is streaming");
  const stream = await ctx.channel.stream("api", "chat", request(params), { signal: ctx.signal });
  for await (const chunk of stream) ctx.stream.push(chunk as ModelStreamChunk);
}

export const definition: Definition = {
  provides: ["model.adapter.api"],
  requires: [{ capability: "api" }],
  configKeys: [],
  methods: {
    describe() {
      return { id: "api", name: "API (legacy)" };
    },
    discover(): DiscoveredModel[] {
      return [];
    },
    async chat(params, ctx) {
      await chat(params as AdapterChatRequest, ctx);
    },
  },
  selfCheck() {
    return [];
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);
