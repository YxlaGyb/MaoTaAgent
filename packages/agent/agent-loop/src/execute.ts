import type { LoopDeps, StepContext } from "./events.ts";
import { asText, type ToolCall } from "./messages.ts";

export type CallTool = (call: ToolCall, ctx: StepContext) => Promise<unknown>;

interface Settled {
  call: ToolCall;
  ok: boolean;
  output: unknown;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

async function safeToRun(call: ToolCall, deps: LoopDeps, ctx: StepContext): Promise<boolean> {
  if (deps.classify === undefined) return false;
  try {
    return (await deps.classify(call, ctx)) === true;
  } catch {
    return false;
  }
}

export function batchesOf(
  calls: readonly ToolCall[],
  safety: readonly boolean[],
  maxParallel: number,
): ToolCall[][] {
  const batches: ToolCall[][] = [];
  let run: ToolCall[] = [];
  const flush = (): void => {
    if (run.length > 0) batches.push(run);
    run = [];
  };
  calls.forEach((call, index) => {
    if (safety[index] !== true) {
      flush();
      batches.push([call]);
      return;
    }
    run.push(call);
    if (run.length === maxParallel) flush();
  });
  flush();
  return batches;
}

async function runOne(call: ToolCall, deps: LoopDeps, ctx: StepContext): Promise<Settled> {
  let item: Settled;
  try {
    item = { call, ok: true, output: await deps.callTool(call, ctx) };
  } catch (error) {
    item = { call, ok: false, output: error instanceof Error ? error.message : String(error) };
  }
  ctx.emit({ type: "tool_result", id: call.id, tool: call.name, ok: item.ok, output: item.output });
  return item;
}

export async function executeCalls(calls: readonly ToolCall[], deps: LoopDeps, ctx: StepContext): Promise<void> {
  const safety: boolean[] = [];
  for (const call of calls) safety.push(await safeToRun(call, deps, ctx));

  for (const batch of batchesOf(calls, safety, positiveInteger(deps.max_parallel, 1))) {
    if (ctx.signal.aborted) return;
    for (const call of batch) ctx.emit({ type: "tool_call", id: call.id, tool: call.name, args: call.args });
    const settled = await Promise.all(batch.map((call) => runOne(call, deps, ctx)));
    for (const item of settled) {
      ctx.state.messages.push({
        role: "tool",
        tool_call_id: item.call.id,
        name: item.call.name,
        content: item.ok ? asText(item.output) : JSON.stringify({ error: String(item.output) }),
      });
    }
  }
}