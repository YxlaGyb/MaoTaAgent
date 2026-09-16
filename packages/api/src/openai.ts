// 一个 POST 到 /chat/completions。任何 OpenAI 兼容网关都吃这个形状，
// 所以这里不做 SDK、不做重试 —— 重试是调用方的决定（PROTOCOL.md 第 6 节）。
import { CallError } from "../../plugin-kit/src/index.ts";
import type { ChatReply, ChatRequest } from "./messages.ts";

export interface Gateway {
  base_url: string;
  api_key: string;
}

/**
 * 插件给的 spec 是扁平的 `{name, description, input_schema}`（工具作者写起来短）,
 * 而 OpenAI 要的是 `{type:"function", function:{...}}`。网关这一层负责这个形状差,
 * 这样插件不必知道对面是谁。
 */
export function asOpenAITools(tools: readonly unknown[]): unknown[] {
  return tools.map((tool) => {
    const spec = tool as { type?: unknown; name?: unknown; description?: unknown; input_schema?: unknown; parameters?: unknown };
    if (spec?.type === "function") return tool; // 已经是模型形状了就别再包一层
    return {
      type: "function",
      function: {
        name: spec?.name,
        description: spec?.description,
        parameters: spec?.parameters ?? spec?.input_schema ?? { type: "object", properties: {} },
      },
    };
  });
}

export async function chat(gateway: Gateway, request: ChatRequest, signal?: AbortSignal): Promise<ChatReply> {
  const url = `${gateway.base_url.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${gateway.api_key}` },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      ...(request.tools ? { tools: asOpenAITools(request.tools) } : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
    signal: signal ?? null,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CallError(-32603, `upstream ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }

  const body = (await response.json()) as { choices?: Array<{ message?: unknown }>; usage?: unknown };
  const message = body.choices?.[0]?.message;
  if (!message || typeof message !== "object") {
    throw new CallError(-32603, "upstream reply has no choices[0].message");
  }
  return { message: message as ChatReply["message"], usage: body.usage };
}