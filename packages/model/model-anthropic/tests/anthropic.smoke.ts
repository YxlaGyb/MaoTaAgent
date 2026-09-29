import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import type { Call } from "@maota/plugin-kit";
import type { AdapterChatRequest, ModelStreamChunk } from "@maota/model-protocol";

import { definition } from "../src/index.ts";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(typeof address === "object" && address !== null ? address.port : 0);
  }));
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += String(chunk); });
  request.on("end", () => {
    const model = (JSON.parse(body || "{}") as { model?: string }).model;
    if (model === "auth") {
      response.writeHead(401);
      response.end("no key");
      return;
    }
    if (model === "limit") {
      response.writeHead(429, { "retry-after": "2", "request-id": "req_1" });
      response.end("slow down");
      return;
    }
    if (model === "context") {
      response.writeHead(400);
      response.end("context too long");
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (model === "slow") {
      response.write('event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"x"}}\n\n');
      return;
    }
    response.write('event: content_block_delta\ndata: {"index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}\n\n');
    response.write('event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n');
    response.write('event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"read"}}\n\n');
    response.write('event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file\\":\\"a\\"}"}}\n\n');
    response.write('event: content_block_stop\ndata: {"index":1}\n\n');
    response.write('event: message_stop\ndata: {}\n\n');
    response.end();
  });
});

const port = await listen(server);
server.unref();
const base: AdapterChatRequest = {
  route: { provider: "p1", model: "ok" },
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  provider: { id: "p1", name: "Anthropic", adapter: "anthropic", base_url: `http://127.0.0.1:${port}`, auth: { kind: "file" }, enabled: true, verified: true },
  model: { provider: "p1", model: "ok", name: "Claude", capabilities: { tools: true, vision: false }, reasoning_efforts: [], enabled: true, verified: true },
  api_key: "sk",
  idle_timeout_ms: 5_000,
};

async function chat(params: AdapterChatRequest, signal = new AbortController().signal): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];
  const ctx = {
    signal,
    stream: { push: (chunk: ModelStreamChunk) => chunks.push(chunk) },
  } as unknown as Call;
  await (definition.methods.chat as (params: unknown, ctx: Call) => Promise<void>)(params, ctx);
  return chunks;
}

const chunks = await chat(base);
assert.deepEqual(chunks.map((chunk) => chunk.type), ["reasoning", "delta", "message"]);
const message = chunks.at(-1);
assert.equal(message?.type, "message");
if (message?.type === "message") {
  assert.equal(message.message.content, "hi");
  assert.deepEqual(message.message.tool_calls, [
    { id: "tool_1", type: "function", function: { name: "read", arguments: '{"file":"a"}' } },
  ]);
}

for (const [model, code, retry] of [["auth", -32050, undefined], ["limit", -32051, 2000], ["context", -32056, undefined]] as const) {
  const params = { ...base, model: { ...base.model, model }, route: { provider: "p1", model } };
  await assert.rejects(
    chat(params),
    (error: { code?: number; data?: { retry_after_ms?: number } }) => error.code === code && error.data?.retry_after_ms === retry,
  );
}

const controller = new AbortController();
const cancelled = chat({ ...base, model: { ...base.model, model: "slow" }, route: { provider: "p1", model: "slow" } }, controller.signal);
setTimeout(() => controller.abort(), 20);
await assert.rejects(cancelled, (error: { code?: number }) => error.code === -32013);

server.closeAllConnections?.();
server.close();
console.log("model anthropic adapter ok: stream, tools, failures and cancellation");
