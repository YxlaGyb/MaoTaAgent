export type TurnKind = "user" | "job" | "schedule";

export interface TurnSource {
  kind: TurnKind;
  id?: string;
  occurrence?: string;
  mode?: string;
  title?: string;
}

export interface TurnInput {
  session_id: string;
  cwd: string;
  input: string;
  thinking?: string;
  route?: { provider: string; model: string; reasoning?: string };
  source: TurnSource;
  permission?: "ask" | "auto" | "full";
  max_steps?: number;
  tools_deny?: string[];
}

export interface TurnResult {
  turn_id: string;
  session_id: string;
  text: string;
  reason: string;
  steps: number;
  deferred?: boolean;
}

export interface TurnEvent {
  type: "queued" | "start" | "text" | "reasoning" | "tool_call" | "tool_result" | "done" | "error";
  turn_id: string;
  session_id: string;
  source: TurnSource;
  text?: string;
  step?: number;
  tool?: string;
  id?: string;
  args?: unknown;
  ok?: boolean;
  output?: unknown;
  steps?: number;
  reason?: string;
  code?: number;
  message?: string;
}
