import { executeCalls } from "./execute.ts";
import type { LoopDeps, LoopEvent, LoopOutcome, LoopState, StepContext, StopDecision } from "./events.ts";
import { sourcedMessages, toolCalls, type Message } from "./messages.ts";

/// The label a steered continuation carries, so a session reader can tell it
/// from what the person typed.
const STEER_SOURCE = "hook:stop";

export async function runLoop(
  deps: LoopDeps,
  messages: Message[],
  signal: AbortSignal,
  emit: (event: LoopEvent) => void,
): Promise<LoopOutcome> {
  const state: LoopState = {
    messages,
    step: 0,
    maxSteps: deps.max_steps,
    lastReason: null,
    stopSteered: false,
    haltRequested: false,
  };
  while (state.step < state.maxSteps) {
    if (signal.aborted) return finish(state, "", "aborted");
    state.step += 1;
    const ctx = stepContext(deps, state, signal, emit);
    emit({ type: "step", step: state.step });

    const message = await deps.chat(ctx);
    state.messages.push(message);
    // A turn cancelled while the model was answering ends here, the same way a
    // cancelled tool round does, and never reaches the stop seam.
    if (signal.aborted) return finish(state, "", "aborted");
    const calls = toolCalls(message);
    if (calls.length === 0) {
      const text = typeof message.content === "string" ? message.content : "";
      const stop = await stopDecision(deps, state, ctx);
      for (const note of sourcedMessages(stop?.context ?? [])) state.messages.push(note);
      const steer = stop?.steer;
      if (typeof steer === "string" && steer.trim() !== "" && !state.stopSteered) {
        state.stopSteered = true;
        state.messages.push({ role: "user", name: STEER_SOURCE, content: steer });
        continue;
      }
      return finish(state, text, "completed");
    }

    await executeCalls(calls, deps, ctx);
    if (state.haltRequested) return finish(state, "", "stopped");
    if (signal.aborted) return finish(state, "", "aborted");
  }
  return finish(state, "", "max_steps");
}

async function stopDecision(deps: LoopDeps, state: LoopState, ctx: StepContext): Promise<StopDecision | undefined> {
  if (deps.atStop === undefined) return undefined;
  try {
    return (await deps.atStop(state, ctx)) ?? undefined;
  } catch {
    return undefined;
  }
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
