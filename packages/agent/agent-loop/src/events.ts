import type { Message, SourcedText, ToolCall, ToolSpec } from "./messages.ts";

/// `refused` means the embedder refused the prompt before any model call;
/// `stopped` means the post-tool seam asked the run to stop mid-round.
export type LoopExitReason = "completed" | "aborted" | "max_steps" | "refused" | "stopped";

export type LoopEvent =
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; tool: string; args: unknown }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; output: unknown }
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
  /// Set once the stop seam has steered one continuation, so it can never keep
  /// the run alive forever.
  stopSteered: boolean;
  /// Set by the post-tool seam; the loop ends after the batch that produced it.
  haltRequested: boolean;
}

export interface StepContext {
  state: LoopState;
  tools: readonly ToolSpec[];
  step: number;
  signal: AbortSignal;
  emit(event: LoopEvent): void;
  delta(chunk: ChatDelta): void;
}

export interface ToolRunOutcome {
  ok: boolean;
  output: unknown;
}

export interface PreToolDecision {
  decision?: "allow" | "deny";
  reason?: string;
  context?: SourcedText[];
  args?: unknown;
}

export interface PostToolDecision {
  context?: SourcedText[];
  halt?: boolean;
  output?: unknown;
}

export interface StopDecision {
  context?: SourcedText[];
  steer?: string;
}

export interface LoopDeps {
  tools: readonly ToolSpec[];
  max_steps: number;
  max_parallel?: number;
  chat(ctx: StepContext): Promise<Message>;
  callTool(call: ToolCall, ctx: StepContext): Promise<unknown>;
  classify?(call: ToolCall, ctx: StepContext): Promise<boolean>;
  /// Runs before the call is dispatched and before `classify`: a refusal skips
  /// both, so a refused call is never handed to a tool. An `allow` loosens
  /// nothing, because `classify` and the tool's own approval still run.
  /// `args` replaces what the model wrote, and the replacement is what runs.
  preTool?(call: ToolCall, ctx: StepContext): Promise<PreToolDecision | null | undefined>;
  /// Runs after the call settled and before its result is written back, so
  /// `output` is what the model ends up reading.
  postTool?(call: ToolCall, outcome: ToolRunOutcome, ctx: StepContext): Promise<PostToolDecision | null | undefined>;
  /// Runs only when the model asked for no tool call, which is the moment the
  /// run would otherwise end.
  atStop?(state: LoopState, ctx: StepContext): Promise<StopDecision | null | undefined>;
}

export interface LoopOutcome {
  steps: number;
  text: string;
  reason: LoopExitReason;
}
