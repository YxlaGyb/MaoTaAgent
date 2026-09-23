import { Fragment, useEffect, useRef } from "react";

import { useT } from "../lib/i18n.ts";
import type { Approval, HostEvent, SessionMessage, SessionSummary } from "../lib/rpc.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { Markdown, MessageItem, ToolRow } from "./MessageItem.tsx";
import { SubagentCard } from "./SubagentCard.tsx";

export interface LiveTool {
  tool: string;
  id?: string;
  args?: unknown;
  ok?: boolean;
  output?: unknown;
}

export type SubagentStatus = "running" | "done" | "partial" | "failed";

export interface LiveSubagent {
  id: string;
  call_id: string;
  type: string;
  description: string;
  status: SubagentStatus;
  steps: number;
  tools: LiveTool[];
}

export interface LiveTurn {
  turn_id: string;
  text: string;
  reasoning: string;
  step: number;
  /// How much had been streamed when the current attempt began, so an attempt
  /// that gets replaced can be cut back to where it started.
  mark: { text: number; reasoning: number };
  tools: LiveTool[];
  subagents: LiveSubagent[];
  running: boolean;
}

function statusOf(event: HostEvent): SubagentStatus {
  if (event.ok === true) return "done";
  if (event.reason === "max_steps") return "partial";
  return "failed";
}

function heard(subagent: LiveSubagent, event: HostEvent): LiveSubagent {
  return subagent.id === (event.subagent_id ?? "") ? { ...subagent, steps: event.step ?? subagent.steps } : subagent;
}

export function applyEvent(turn: LiveTurn, event: HostEvent): LiveTurn {
  switch (event.event) {
    case "text":
      return { ...turn, text: turn.text + (event.text ?? "") };
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + (event.text ?? "") };
    case "step":
      return {
        ...turn,
        step: event.step ?? turn.step,
        mark: { text: turn.text.length, reasoning: turn.reasoning.length },
      };
    case "retract":
      // One question never shows two answers: what the replaced attempt had
      // already streamed is cut off at the point that attempt began.
      return {
        ...turn,
        text: turn.text.slice(0, turn.mark.text),
        reasoning: turn.reasoning.slice(0, turn.mark.reasoning),
      };
    case "tool_call":
      return { ...turn, tools: [...turn.tools, { tool: event.tool ?? "", id: event.id, args: event.args }] };
    case "tool_result":
      return { ...turn, tools: fillResult(turn.tools, event) };
    case "subagent.started":
      return {
        ...turn,
        subagents: [
          ...turn.subagents,
          {
            id: event.subagent_id ?? "",
            call_id: event.parent_call_id ?? "",
            type: event.type === undefined || event.type === "" ? "general" : event.type,
            description: event.description ?? "",
            status: "running",
            steps: 0,
            tools: [],
          },
        ],
      };
    case "subagent.step":
      return { ...turn, subagents: turn.subagents.map((subagent) => heard(subagent, event)) };
    case "subagent.tool_call":
      return {
        ...turn,
        subagents: turn.subagents.map((subagent) =>
          subagent.id !== (event.subagent_id ?? "")
            ? subagent
            : { ...subagent, tools: [...subagent.tools, { tool: event.tool ?? "", id: event.id, args: event.args }] },
        ),
      };
    case "subagent.tool_result":
      return {
        ...turn,
        subagents: turn.subagents.map((subagent) =>
          subagent.id !== (event.subagent_id ?? "")
            ? subagent
            : { ...subagent, tools: fillResult(subagent.tools, event) },
        ),
      };
    case "subagent.finished":
      return {
        ...turn,
        subagents: turn.subagents.map((subagent) =>
          subagent.id !== (event.subagent_id ?? "")
            ? subagent
            : { ...subagent, status: statusOf(event), steps: event.steps ?? subagent.steps },
        ),
      };
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
  spawned,
  cwd,
  onAnswer,
}: {
  messages: SessionMessage[];
  pending: string | null;
  live: LiveTurn | null;
  approvals: Approval[];
  spawned: Record<string, SessionSummary[]>;
  cwd: string;
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
          <MessageItem key={index} message={message} spawned={spawned} />
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
                {live.subagents
                  .filter((subagent) => subagent.call_id !== "" && subagent.call_id === tool.id)
                  .map((subagent) => (
                    <SubagentCard key={subagent.id} subagent={subagent} cwd={cwd} />
                  ))}
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
