import assert from "node:assert/strict";
import type { Call } from "@maota/plugin-kit";
import type { AdapterChatRequest, ModelStreamChunk } from "@maota/model-protocol";
import { definition } from "../src/index.ts";

const base: AdapterChatRequest = {
  route: { provider: "api", model: "gpt-4o-mini" },
  messages: [{ role: "user", content: "hi" }],
  provider: { id: "api", name: "API (legacy)", adapter: "api", base_url: "", auth: { kind: "file" }, enabled: true, verified: true },
  model: { provider: "api", model: "gpt-4o-mini", name: "GPT-4o mini", capabilities: { tools: true, vision: false }, reasoning_efforts: [], enabled: true, verified: true },
  api_key: "",
};

const seen: Array<{ capability: string; method: string; params: Record<string, unknown> }> = [];
const chunks: ModelStreamChunk[] = [
  { type: "delta", text: "hi" },
  { type: "message", message: { role: "assistant", content: "hi" } },
];
const output: ModelStreamChunk[] = [];
const ctx = {
  signal: new AbortController().signal,
  stream: { push: (chunk: ModelStreamChunk) => output.push(chunk) },
  channel: {
    stream: async (capability: string, method: string, params: Record<string, unknown>) => {
      seen.push({ capability, method, params });
      return (async function* () { for (const chunk of chunks) yield chunk; })();
    },
  },
} as unknown as Call;

assert.deepEqual(definition.methods.describe?.({}, ctx), { id: "api", name: "API (legacy)" });
assert.deepEqual(definition.methods.discover?.({}, ctx), []);
await (definition.methods.chat as (params: unknown, ctx: Call) => Promise<void>)(base, ctx);
assert.equal(seen[0]?.capability, "api");
assert.equal(seen[0]?.method, "chat");
assert.equal(seen[0]?.params.model, "gpt-4o-mini");
assert.deepEqual(output, chunks);
console.log("model api adapter ok: forwards the legacy API stream");
