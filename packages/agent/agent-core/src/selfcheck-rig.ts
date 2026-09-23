/// The fixture every group of self checks builds on: a scripted deployment whose
/// channel answers the capabilities a run asks for and records what it was
/// asked. A check varies three things — the conversation, the skill catalog and
/// the hook's answer — so those are the three slots this rig hands back, and the
/// runs it starts are real `definition.methods.run` calls over a wiring that
/// never reaches a process.

import { type Call, type Definition } from "@maota/plugin-kit";
import { kindOfCode, type LoopEvent, type Message, type ToolSpec } from "@maota/agent-loop";

export interface RunResult {
  call: Call;
  chat: Array<{ messages: Message[]; tools?: ToolSpec[]; model?: string }>;
  events: LoopEvent[];
  heard: Array<{ capability: string; method: string; params: any }>;
  sent: Array<{ topic: string; payload: Record<string, any> }>;
  done: Promise<unknown>;
}

export interface Rig {
  readonly saves: Array<Record<string, any>>;
  readonly published: Array<{ topic: string; payload: Record<string, any> }>;
  readonly calls: Array<{ capability: string; method: string; params: any }>;
  history: Message[];
  catalog: unknown;
  hookAnswer: (params: any) => unknown;
  /// How many replacements the fake adapter performs before it reports the
  /// failure, which is the adapter's own decision and not the run's.
  retries: number;
  failCode: number;
  scripted(content: string, tool?: string): Message;
  surfaced(chat: Array<{ tools?: ToolSpec[] }>): string;
  run(
    params: Record<string, unknown>,
    script: readonly Message[],
    gate?: Promise<void>,
    failChat?: boolean | number,
  ): RunResult;
}

export function createRig(definition: Definition): Rig {
  const published: Array<{ topic: string; payload: Record<string, any> }> = [];
  const calls: Array<{ capability: string; method: string; params: any }> = [];
  const saves: Array<Record<string, any>> = [];
  const listed: ToolSpec[] = [
    { name: "read", description: "read a file", paths: ["file_path"] },
    { name: "write", description: "write a file" },
    { name: "task", description: "ask another agent" },
    { name: "skill", description: "load a skill", host_args: [{ name: "cwd", source: "session_cwd" }] },
  ];

  const rig: Rig = {
    saves,
    published,
    calls,
    history: [{ role: "user", content: "earlier" }],
    catalog: { complete: true, entries: [{ name: "s", description: "d" }], text: "catalog text" },
    hookAnswer: () => ({}),
    retries: 0,
    failCode: -32053,
    scripted: (content, tool) => ({
      role: "assistant",
      content: tool === undefined ? content : null,
      ...(tool === undefined ? {} : { tool_calls: [{ id: `t-${tool}`, function: { name: tool, arguments: "{}" } }] }),
    }),
    surfaced: (chat) => (chat[0]?.tools ?? []).map((tool) => tool.name).join(","),
    run(params, script, gate, failChat = false) {
      const chat: Array<{ messages: Message[]; tools?: ToolSpec[]; model?: string }> = [];
      const events: LoopEvent[] = [];
      const heard: Array<{ capability: string; method: string; params: any }> = [];
      const sent: Array<{ topic: string; payload: Record<string, any> }> = [];
      const queue = [...script];
      const channel = {
        call: async (capability: string, method: string, params: any) => {
          const record = { capability, method, params };
          calls.push(record);
          heard.push(record);
          if (capability === "tools" && method === "list") return { tools: listed };
          if (capability === "skill" && method === "catalog") return rig.catalog;
          if (capability === "permission" && method === "policy") return { mode: "ask" };
          if (capability === "system-prompt" && method === "assemble") {
            return {
              text: [
                params.persona ?? "the harness speaks first",
                `working directory: ${params.cwd}`,
                `approval: ${params.approval}`,
              ].join("\n\n"),
              sections: [],
              variables: [],
            };
          }
          if (capability === "session" && method === "load") return { messages: rig.history };
          if (capability === "session" && method === "save") {
            saves.push(params);
            return {};
          }
          if (capability === "tools" && method === "classify") return { safe: true };
          if (capability === "tools" && method === "call") return "tool output";
          if (capability === "api" && method === "chat") return { message: { role: "assistant", content: "folded note" } };
          if (capability === "hooks" && method === "trigger") return rig.hookAnswer(params);
          throw new Error(`unexpected call ${capability}/${method}`);
        },
        stream: async (_capability: string, _method: string, params: any) => {
          chat.push(params);
          const call = chat.length;
          if (gate !== undefined) await gate;
          // A number names the call that fails, and one that fails after it has
          // already spoken is the shape a real stream has. Whether the failure
          // is replaced is the adapter's decision, and the run learns about a
          // replacement from the two chunks a real adapter sends rather than
          // from a question it was asked.
          async function* body() {
            const broken = failChat === true || failChat === call;
            if (!broken) {
              const message = queue.shift() ?? { role: "assistant", content: "done" };
              yield { type: "message", message };
              return;
            }
            if (failChat !== true) yield { type: "delta", text: "half an answer" };
            const failure = {
              message: "the upstream broke",
              code: rig.failCode,
              kind: kindOfCode(rig.failCode),
            };
            if (rig.retries === 0) {
              yield { type: "error", failure };
              return;
            }
            yield {
              type: "retry",
              phase: "scheduled",
              attempt: 1,
              delay_ms: 0,
              failure,
              reason: `\`${failure.kind}\` is worth another attempt`,
            };
            yield { type: "retry", phase: "started", attempt: 1, delay_ms: 0 };
            const message = queue.shift() ?? { role: "assistant", content: "done" };
            yield { type: "message", message };
          }
          return { [Symbol.asyncIterator]: body };
        },
        publish: async (topic: string, payload: unknown) => {
          const record = { topic, payload: payload as Record<string, any> };
          published.push(record);
          sent.push(record);
        },
        log: () => {},
      };
      const call = {
        channel,
        config: {},
        capabilities: { session: { plugin: "session" } },
        capability: "agent.loop",
        method: "run",
        caller: "tool-subagent",
        signal: new AbortController().signal,
        stream: { push: (event: LoopEvent) => events.push(event) },
      } as unknown as Call;
      return { call, chat, events, heard, sent, done: Promise.resolve(definition.methods.run?.(params, call)) };
    },
  };
  return rig;
}
