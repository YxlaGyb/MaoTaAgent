import type { Message, ToolCall, ToolSpec } from "./messages.ts";

export type LoopExitReason = "completed" | "aborted" | "max_steps";

export type LoopEvent =
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; output: unknown }
  | { type: "tick" }
  | { type: "done"; steps: number; text: string; reason: LoopExitReason };

export interface ChatDelta {
  text?: string;
  reasoning?: string;
}

export interface LoopState {
  messages: Message[];
  step: number;
  maxSteps: number;
  lastReason: LoopExitReason | null;
}

export interface StepContext {
  state: LoopState;
  tools: readonly ToolSpec[];
  step: number;
  signal: AbortSignal;
  emit(event: LoopEvent): void;
  delta(chunk: ChatDelta): void;
}

export interface LoopDeps {
  tools: readonly ToolSpec[];
  max_steps: number;
  chat(ctx: StepContext): Promise<Message>;
  callTool(call: ToolCall, ctx: StepContext): Promise<unknown>;
}

export interface LoopOutcome {
  steps: number;
  text: string;
  reason: LoopExitReason;
}
