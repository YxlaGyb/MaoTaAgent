import { executeCalls } from "./execute.ts";
import type { LoopDeps, LoopEvent, LoopOutcome, LoopState, StepContext } from "./events.ts";
import { toolCalls, type Message } from "./messages.ts";

export async function runLoop(
  deps: LoopDeps,
  messages: Message[],
  signal: AbortSignal,
  emit: (event: LoopEvent) => void,
): Promise<LoopOutcome> {
  const state: LoopState = { messages, step: 0, maxSteps: deps.max_steps, lastReason: null };
  while (state.step < state.maxSteps) {
    if (signal.aborted) return finish(state, "", "aborted");
    state.step += 1;
    const ctx = stepContext(deps, state, signal, emit);
    emit({ type: "step", step: state.step });

    const message = await deps.chat(ctx);
    state.messages.push(message);
    const calls = toolCalls(message);
    if (calls.length === 0) {
      return finish(state, typeof message.content === "string" ? message.content : "", "completed");
    }

    await executeCalls(calls, deps.callTool, ctx);
    if (signal.aborted) return finish(state, "", "aborted");
  }
  return finish(state, "", "max_steps");
}

function stepContext(
  deps: LoopDeps,
  state: LoopState,
  signal: AbortSignal,
  emit: (event: LoopEvent) => void,
): StepContext {
  return {
    state,
    tools: deps.tools,
    step: state.step,
    signal,
    emit,
    delta(chunk) {
      if (typeof chunk.text === "string" && chunk.text !== "") emit({ type: "text", text: chunk.text });
      if (typeof chunk.reasoning === "string" && chunk.reasoning !== "") {
        emit({ type: "reasoning", text: chunk.reasoning });
      }
    },
  };
}

function finish(state: LoopState, text: string, reason: LoopOutcome["reason"]): LoopOutcome {
  state.lastReason = reason;
  return { steps: state.step, text, reason };
}
