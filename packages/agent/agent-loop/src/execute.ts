import type { LoopDeps, PostToolDecision, PreToolDecision, StepContext } from "./events.ts";
import { asText, sourcedMessages, type SourcedText, type ToolCall } from "./messages.ts";

export type CallTool = (call: ToolCall, ctx: StepContext) => Promise<unknown>;

/// How one call may be batched: `parallel` may share a batch with its
/// neighbours, `serial` must run alone, and `blocked` never runs at all
/// because the pre-tool seam refused it.
export type Disposition = "parallel" | "serial" | "blocked";

interface Settled {
  call: ToolCall;
  ok: boolean;
  output: unknown;
}

interface Planned {
  call: ToolCall;
  disposition: Disposition;
  /// Why the call never ran, when `disposition` is `blocked`.
  blocked?: string;
  /// Text the pre-tool seam contributed for this call.
  context: SourcedText[];
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/// A seam is an extra layer, never the last one: a seam that throws, times out
/// or is not wired contributes nothing, and the layers under it still decide.
async function preDecision(call: ToolCall, deps: LoopDeps, ctx: StepContext): Promise<PreToolDecision | undefined> {
  if (deps.preTool === undefined) return undefined;
  try {
    return (await deps.preTool(call, ctx)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function postDecision(item: Settled, deps: LoopDeps, ctx: StepContext): Promise<PostToolDecision | undefined> {
  if (deps.postTool === undefined) return undefined;
  try {
    return (await deps.postTool(item.call, { ok: item.ok, output: item.output }, ctx)) ?? undefined;
  } catch {
    return undefined;
  }
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
  dispositions: readonly Disposition[],
  maxParallel: number,
): ToolCall[][] {
  const batches: ToolCall[][] = [];
  let run: ToolCall[] = [];
  const flush = (): void => {
    if (run.length > 0) batches.push(run);
    run = [];
  };
  calls.forEach((call, index) => {
    if (dispositions[index] !== "parallel") {
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

async function runOne(plan: Planned, deps: LoopDeps, ctx: StepContext): Promise<Settled> {
  if (plan.blocked !== undefined) {
    ctx.emit({ type: "tool_result", id: plan.call.id, tool: plan.call.name, ok: false, output: plan.blocked });
    return { call: plan.call, ok: false, output: plan.blocked };
  }
  let item: Settled;
  try {
    item = { call: plan.call, ok: true, output: await deps.callTool(plan.call, ctx) };
  } catch (error) {
    item = { call: plan.call, ok: false, output: messageOf(error) };
  }
  ctx.emit({ type: "tool_result", id: plan.call.id, tool: plan.call.name, ok: item.ok, output: item.output });
  return item;
}

export async function executeCalls(calls: readonly ToolCall[], deps: LoopDeps, ctx: StepContext): Promise<void> {
  const plans: Planned[] = [];
  for (const call of calls) {
    const pre = await preDecision(call, deps, ctx);
    if (pre?.decision === "deny") {
      plans.push({
        call,
        disposition: "blocked",
        blocked: pre.reason ?? `refused: ${call.name}`,
        context: pre.context ?? [],
      });
      continue;
    }
    const safe = await safeToRun(call, deps, ctx);
    plans.push({ call, disposition: safe ? "parallel" : "serial", context: pre?.context ?? [] });
  }

  const planned = new Map(plans.map((plan) => [plan.call.id, plan]));
  const batches = batchesOf(calls, plans.map((plan) => plan.disposition), positiveInteger(deps.max_parallel, 1));

  for (const batch of batches) {
    if (ctx.signal.aborted) return;
    for (const call of batch) ctx.emit({ type: "tool_call", id: call.id, tool: call.name, args: call.args });

    const grouped = planned.get(batch[0]!.id)?.disposition === "parallel";
    const settled = grouped
      ? await Promise.all(batch.map((call) => runOne(planned.get(call.id)!, deps, ctx)))
      : [await runOne(planned.get(batch[0]!.id)!, deps, ctx)];

    for (const item of settled) {
      ctx.state.messages.push({
        role: "tool",
        tool_call_id: item.call.id,
        name: item.call.name,
        content: item.ok ? asText(item.output) : JSON.stringify({ error: String(item.output) }),
      });
    }

    const context = batch.flatMap((call) => planned.get(call.id)?.context ?? []);
    let halt = false;
    for (const item of settled) {
      const post = await postDecision(item, deps, ctx);
      context.push(...(post?.context ?? []));
      if (post?.halt === true) halt = true;
    }
    for (const message of sourcedMessages(context)) ctx.state.messages.push(message);
    if (halt) {
      ctx.state.haltRequested = true;
      return;
    }
  }
}
