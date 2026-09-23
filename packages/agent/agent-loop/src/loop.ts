import { executeCalls } from "./execute.ts";
import { failureOfError } from "./failure.ts";
import type {
  LoopDeps,
  LoopEvent,
  LoopOutcome,
  LoopState,
  ModelErrorDecision,
  StepContext,
  StopDecision,
} from "./events.ts";
import type { ModelFailure } from "./failure.ts";
import { sourcedMessages, toolCalls, type Message } from "./messages.ts";

/// The label a steered continuation carries, so a session reader can tell it
/// from what the person typed.
const STEER_SOURCE = "hook:stop";
/// The label a correction a recovery policy wrote carries, kept apart from the
/// hook's because the two are asked for different reasons.
const RECOVERY_SOURCE = "recovery:model";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

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
    streamed: false,
  };
  while (state.step < state.maxSteps) {
    if (signal.aborted) return finish(state, "", "aborted");
    state.step += 1;
    state.streamed = false;
    const ctx = stepContext(deps, state, signal, emit);
    emit({ type: "step", step: state.step });

    let message: Message;
    try {
      message = await deps.chat(ctx);
    } catch (error) {
      const failure = failureOfError(error);
      const decision = await modelError(deps, failure, ctx);
      // A turn cancelled while the model was failing was cancelled: the
      // accident is not allowed to name a turn the person already ended.
      if (signal.aborted) return finish(state, "", "aborted");
      if (decision === undefined || decision.action !== "retry") {
        return finish(state, "", "model_error", failure);
      }
      // The attempt being replaced has already been seen, so it is taken back
      // before the next one starts: a consumer that kept the text would
      // otherwise show two answers to one question.
      if (state.streamed) emit({ type: "retract", reason: failure.kind });
      state.step -= 1;
      await wait(decision.delay_ms ?? 0, signal);
      if (signal.aborted) return finish(state, "", "aborted");
      if (typeof decision.steer === "string" && decision.steer.trim() !== "") {
        state.messages.push({ role: "user", name: RECOVERY_SOURCE, content: decision.steer });
      }
      continue;
    }
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

/// A policy that throws has answered nothing, and a run must not end because
/// the thing asked to keep it alive broke; the failure it was given still ends
/// the run, so nothing is hidden by the silence.
async function modelError(
  deps: LoopDeps,
  failure: ModelFailure,
  ctx: StepContext,
): Promise<ModelErrorDecision | undefined> {
  if (deps.onModelError === undefined) return undefined;
  try {
    return (await deps.onModelError(failure, ctx)) ?? undefined;
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
      // A replacement is announced by the side that decided on it, and what the
      // replaced attempt showed is taken back here, once: a consumer that kept
      // the text would otherwise show two answers to one question.
      if (typeof chunk.retract === "string" && chunk.retract !== "") {
        if (state.streamed) emit({ type: "retract", reason: chunk.retract });
        state.streamed = false;
        return;
      }
      if (typeof chunk.text === "string" && chunk.text !== "") {
        state.streamed = true;
        emit({ type: "text", text: chunk.text });
      }
      if (typeof chunk.reasoning === "string" && chunk.reasoning !== "") {
        state.streamed = true;
        emit({ type: "reasoning", text: chunk.reasoning });
      }
    },
  };
}

function finish(
  state: LoopState,
  text: string,
  reason: LoopOutcome["reason"],
  failure?: ModelFailure,
): LoopOutcome {
  state.lastReason = reason;
  return { steps: state.step, text, reason, ...(failure === undefined ? {} : { failure }) };
}
