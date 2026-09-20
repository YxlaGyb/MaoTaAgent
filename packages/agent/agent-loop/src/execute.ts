import type { StepContext } from "./events.ts";
import { asText, type ToolCall } from "./messages.ts";

export type CallTool = (call: ToolCall, ctx: StepContext) => Promise<unknown>;

export async function executeCalls(
  calls: readonly ToolCall[],
  callTool: CallTool,
  ctx: StepContext,
): Promise<void> {
  for (const call of calls) {
    if (ctx.signal.aborted) return;
    ctx.emit({ type: "tool_call", tool: call.name, args: call.args });
    let output: unknown;
    let ok = true;
    try {
      output = await callTool(call, ctx);
    } catch (error) {
      ok = false;
      output = error instanceof Error ? error.message : String(error);
    }
    ctx.emit({ type: "tool_result", tool: call.name, ok, output });
    ctx.state.messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: call.name,
      content: ok ? asText(output) : JSON.stringify({ error: String(output) }),
    });
  }
}
