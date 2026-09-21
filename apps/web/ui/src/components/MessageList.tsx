import { Fragment, useEffect, useRef } from "react";

import { useT } from "../lib/i18n.ts";
import type { Approval, HostEvent, SessionMessage } from "../lib/rpc.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { Markdown, MessageItem, ToolRow } from "./MessageItem.tsx";

export interface LiveTool {
  tool: string;
  id?: string;
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
      return { ...turn, tools: [...turn.tools, { tool: event.tool ?? "", id: event.id, args: event.args }] };
    case "tool_result":
      return { ...turn, tools: fillResult(turn.tools, event) };
    default:
      return turn;
  }
}

function fillResult(tools: LiveTool[], event: HostEvent): LiveTool[] {
  const id = event.id;
  const at = id !== undefined && id !== ""
    ? tools.findIndex((tool) => tool.id === id)
    : tools.findIndex((tool) => tool.tool === (event.tool ?? "") && tool.ok === undefined);
  const index = at < 0 ? tools.length - 1 : at;
  return tools.map((tool, here) => (here === index ? { ...tool, ok: event.ok, output: event.output } : tool));
}

export function MessageList({
  messages,
  pending,
  live,
  approvals,
  onAnswer,
}: {
  messages: SessionMessage[];
  pending: string | null;
  live: LiveTurn | null;
  approvals: Approval[];
  onAnswer: (id: string, decision: "allow" | "deny") => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  const byCall = new Map<string, Approval[]>();
  for (const approval of approvals) {
    if (approval.call_id === undefined) continue;
    byCall.set(approval.call_id, [...(byCall.get(approval.call_id) ?? []), approval]);
  }
  const placed = new Set([...byCall.values()].flat().map((approval) => approval.id));
  const loose = approvals.filter((approval) => !placed.has(approval.id));

  useEffect(() => {
    const element = box.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages, pending, live, approvals]);

  return (
    <div
      className="messages"
      ref={box}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}
    >
      <div className="messages-column">
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
              <Fragment key={index}>
                <ToolRow tool={tool.tool} args={tool.args} ok={tool.ok} output={tool.output} />
                {(tool.id === undefined ? [] : (byCall.get(tool.id) ?? [])).map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
                ))}
              </Fragment>
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
        {loose.length === 0 ? null : (
          <div className="msg msg-assistant">
            {loose.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onAnswer={onAnswer} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
