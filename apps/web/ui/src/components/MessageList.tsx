import { useEffect, useRef } from "react";

import { useT } from "../lib/i18n.ts";
import type { HostEvent, SessionMessage } from "../lib/rpc.ts";
import { Markdown, MessageItem, ToolRow } from "./MessageItem.tsx";

export interface LiveTool {
  tool: string;
  args?: unknown;
  ok?: boolean;
  output?: unknown;
}

export interface LiveTurn {
  turn_id: string;
  text: string;
  reasoning: string;
  step: number;
  tools: LiveTool[];
  running: boolean;
}

export function applyEvent(turn: LiveTurn, event: HostEvent): LiveTurn {
  switch (event.event) {
    case "text":
      return { ...turn, text: turn.text + (event.text ?? "") };
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + (event.text ?? "") };
    case "step":
      return { ...turn, step: event.step ?? turn.step };
    case "tool_call":
      return { ...turn, tools: [...turn.tools, { tool: event.tool ?? "", args: event.args }] };
    case "tool_result":
      return { ...turn, tools: fillResult(turn.tools, event) };
    default:
      return turn;
  }
}

function fillResult(tools: LiveTool[], event: HostEvent): LiveTool[] {
  const found = tools.findIndex((tool) => tool.tool === (event.tool ?? "") && tool.ok === undefined);
  const index = found < 0 ? tools.length - 1 : found;
  return tools.map((tool, at) => (at === index ? { ...tool, ok: event.ok, output: event.output } : tool));
}

export function MessageList({
  messages,
  pending,
  live,
}: {
  messages: SessionMessage[];
  pending: string | null;
  live: LiveTurn | null;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  useEffect(() => {
    const element = box.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages, pending, live]);

  return (
    <div
      className="messages"
      ref={box}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}
    >
      {messages.map((message, index) => (
        <MessageItem key={index} message={message} />
      ))}
      {pending === null ? null : <MessageItem message={{ role: "user", content: pending }} />}
      {live === null ? null : (
        <div className="msg msg-assistant">
          {live.reasoning === "" ? null : (
            <details className="thinking-block" open={live.running}>
              <summary>{t("thinkingText")}</summary>
              <pre className="thinking-text">{live.reasoning}</pre>
            </details>
          )}
          {live.tools.map((tool, index) => (
            <ToolRow key={index} tool={tool.tool} args={tool.args} ok={tool.ok} output={tool.output} />
          ))}
          <Markdown text={live.text} />
          {live.running ? (
            <div className="status">
              {t("step", { n: live.step })}
              {live.text === "" ? t("waiting") : ""}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
