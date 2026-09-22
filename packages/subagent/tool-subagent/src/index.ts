#!/usr/bin/env node
import {
  CallError,
  defineTools,
  runPlugin,
  type Call,
  type Definition,
  type Wiring,
} from "@maota/plugin-kit";

import {
  DEFAULT_EXPLORE_SYSTEM,
  DEFAULT_GENERAL_SYSTEM,
  TASK_TOOL,
  childId,
  childPlan,
  failureRefusal,
  limitRefusal,
  readSubagentType,
  subagentResult,
  type ChildPlan,
  type SubagentType,
} from "./task.ts";

interface Settings {
  max_concurrent: number;
  child_max_steps: number;
  child_tools_deny: string[];
  explore_tools: string[];
  general_system: string;
  explore_system: string;
}

const DEFAULTS: Settings = {
  max_concurrent: 4,
  child_max_steps: 8,
  child_tools_deny: [],
  explore_tools: ["read", "glob", "grep"],
  general_system: DEFAULT_GENERAL_SYSTEM,
  explore_system: DEFAULT_EXPLORE_SYSTEM,
};

let settings: Settings = { ...DEFAULTS };

/// The subagents this process has in flight. The count lives here rather than
/// in the loop, because this plugin is the only place that knows which calls
/// are subagents: the loop only knows that a tool with `concurrency: always`
/// may run beside its neighbours.
let running = 0;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function names(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const kept = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  return kept.length === value.length ? kept : fallback;
}

function prose(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function required(value: unknown, name: string): string {
  const found = typeof value === "string" ? value : "";
  if (found.trim() === "") throw new CallError(-32602, `${name} must be a non-empty string`);
  return found;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ChildRun {
  id: string;
  type: SubagentType;
  prompt: string;
  description: string;
  parent: string;
  cwd: string;
  callId: string;
  plan: ChildPlan;
  maxSteps: number;
}

/// The subagent's own loop is read to its end and nothing but its last message
/// is kept: the text, the reasoning and the tool traffic of the run are the
/// subagent's business, and the caller asked for a result, not a transcript.
async function runChild(call: Call, run: ChildRun): Promise<{ text: unknown; reason: string }> {
  let stream;
  try {
    stream = await call.channel.stream(
      "agent.loop",
      "run",
      {
        session_id: run.id,
        cwd: run.cwd,
        input: run.prompt,
        origin: {
          parent_session_id: run.parent,
          parent_call_id: run.callId,
          type: run.type,
          description: run.description,
        },
        system: run.plan.system,
        tools_allow: run.plan.tools_allow,
        tools_deny: run.plan.tools_deny,
        max_steps: run.maxSteps,
      },
      { signal: call.signal },
    );
  } catch (error) {
    if (call.signal.aborted) throw new CallError(-32013, `the ${run.type} subagent was cancelled`);
    throw new CallError(-32603, failureRefusal(run.type, messageOf(error)));
  }

  let done: { text?: unknown; reason?: unknown } | null = null;
  try {
    for await (const chunk of stream) {
      const event = chunk as { type?: unknown; text?: unknown; reason?: unknown } | null;
      if (event?.type === "done") done = event;
    }
  } catch (error) {
    if (call.signal.aborted) throw new CallError(-32013, `the ${run.type} subagent was cancelled`);
    throw new CallError(-32603, failureRefusal(run.type, messageOf(error)));
  }
  if (call.signal.aborted) throw new CallError(-32013, `the ${run.type} subagent was cancelled`);
  if (done === null) throw new CallError(-32603, failureRefusal(run.type, "the run ended without a result"));
  const reason = String(done.reason ?? "completed");
  if (reason === "aborted") throw new CallError(-32013, `the ${run.type} subagent was cancelled`);
  return { text: done.text, reason };
}

const toolkit = defineTools([
  {
    capability: "tool.task",
    version: "1.0.0",
    description:
      "Hand one self-contained piece of work to a subagent. It gets a fresh context of its own, works on the " +
      "task with its own tools, and answers with one final message; nothing else of what it did comes back, so " +
      "ask for exactly what you need in `prompt` and write it as if to a colleague who has not seen this " +
      "conversation. `description` is the short label for the sub-task, and it is what the user sees next to " +
      "the call. `subagent_type` picks the tools it works with: `general` gets every tool, `explore` gets only " +
      "the reading ones (read, glob, grep), which is what to use for looking around. Call it several times in " +
      "one turn to run sub-tasks side by side. A subagent cannot hand work to another subagent.",
    parameters: {
      prompt: {
        type: "string",
        required: true,
        description: "The whole sub-task: the goal, the place to start, and what to hand back.",
      },
      description: {
        type: "string",
        required: true,
        description: "A short label for this sub-task, a few words, shown to the user next to the call.",
      },
      subagent_type: {
        type: "string",
        enum: ["general", "explore"],
        description: "Which kind of subagent to start: general (every tool) or explore (reading tools only).",
      },
      session_id: { type: "string", host: "session_id", description: "The session this call belongs to." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
      call_id: {
        type: "string",
        host: "call_id",
        description: "The id of this tool call, so the subagent's work can be shown under it.",
      },
    },
    concurrency: "always",
    run: async (args, call) => {
      const prompt = required(args.prompt, "prompt");
      const description = required(args.description, "description");
      const type = readSubagentType(args.subagent_type);
      if (running >= settings.max_concurrent) {
        throw new CallError(-32019, limitRefusal(settings.max_concurrent));
      }

      const run: ChildRun = {
        id: childId(),
        type,
        prompt,
        description,
        parent: typeof args.session_id === "string" ? args.session_id : "",
        cwd: typeof args.cwd === "string" ? args.cwd : "",
        callId: typeof args.call_id === "string" ? args.call_id : "",
        plan: childPlan(type, settings),
        maxSteps: settings.child_max_steps,
      };
      running += 1;
      try {
        const outcome = await runChild(call, run);
        return subagentResult(outcome.text, outcome.reason);
      } finally {
        running -= 1;
      }
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  requires: [{ capability: "agent.loop", version: "^1.3" }],
  configKeys: [
    "max_concurrent",
    "child_max_steps",
    "child_tools_deny",
    "explore_tools",
    "general_system",
    "explore_system",
  ],

  setup(wiring: Wiring) {
    settings = {
      max_concurrent: positive(wiring.config.max_concurrent, DEFAULTS.max_concurrent),
      child_max_steps: positive(wiring.config.child_max_steps, DEFAULTS.child_max_steps),
      child_tools_deny: names(wiring.config.child_tools_deny, DEFAULTS.child_tools_deny),
      explore_tools: names(wiring.config.explore_tools, DEFAULTS.explore_tools),
      general_system: prose(wiring.config.general_system, DEFAULTS.general_system),
      explore_system: prose(wiring.config.explore_system, DEFAULTS.explore_system),
    };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const call = { capability: "tool.task" } as unknown as Call;

    const capabilities = toolkit.provides.map((item) => item.capability);
    if (capabilities.join(",") !== "tool.task") problems.push(`the toolkit provides ${capabilities.join(", ")}`);
    const described = toolkit.methods.describe({}, call) as {
      name?: string;
      description?: string;
      input_schema?: { properties?: Record<string, unknown>; required?: string[] };
      host_args?: Array<{ name: string; source: string }>;
    };
    if (described.name !== TASK_TOOL) problems.push(`the tool is named ${JSON.stringify(described.name)}`);
    const published = Object.keys(described.input_schema?.properties ?? {}).join(",");
    if (published !== "prompt,description,subagent_type") problems.push(`the spec publishes ${published}`);
    if ((described.input_schema?.required ?? []).join(",") !== "prompt,description") {
      problems.push(`the required list is ${JSON.stringify(described.input_schema?.required)}`);
    }
    const sources = (described.host_args ?? []).map((item) => `${item.name}=${item.source}`).join(",");
    if (sources !== "session_id=session_id,cwd=session_cwd,call_id=call_id") {
      problems.push(`the host args are ${JSON.stringify(sources)}`);
    }
    const policy = toolkit.methods.policy({}, call) as Record<string, unknown>;
    if (policy.concurrency !== "always") problems.push(`the policy is ${JSON.stringify(policy)}`);
    if ("max_result_chars" in policy) problems.push("a result budget was declared, so long answers cannot spill");

    if (readSubagentType(undefined) !== "general") problems.push("a missing type is not general");
    if (readSubagentType("explore") !== "explore") problems.push("explore was not read back");
    try {
      readSubagentType("deep");
      problems.push("readSubagentType accepted an unknown type");
    } catch {
    }

    const plan = { explore_tools: ["read"], child_tools_deny: ["pwsh"], general_system: "G", explore_system: "E" };
    const explore = childPlan("explore", plan);
    if (explore.tools_allow?.join(",") !== "read" || explore.system !== "E") {
      problems.push(`an explore plan came out as ${JSON.stringify(explore)}`);
    }
    const general = childPlan("general", plan);
    if (general.tools_allow !== null || general.system !== "G") {
      problems.push(`a general plan came out as ${JSON.stringify(general)}`);
    }
    for (const [type, child] of [
      ["explore", explore],
      ["general", general],
    ] as Array<[SubagentType, ChildPlan]>) {
      if (child.tools_deny.join(",") !== `${TASK_TOOL},pwsh`) {
        problems.push(`the ${type} denials are ${JSON.stringify(child.tools_deny)}`);
      }
    }
    const stubborn = childPlan("general", { ...plan, child_tools_deny: ["task", "task", "read"] });
    if (stubborn.tools_deny.join(",") !== "task,read") {
      problems.push(`a redundant denial came out as ${JSON.stringify(stubborn.tools_deny)}`);
    }
    const sneaky = childPlan("explore", { ...plan, explore_tools: ["task", "read"] });
    if (!sneaky.tools_deny.includes(TASK_TOOL)) problems.push("an explore list could re-enable the task tool");

    const id = childId();
    if (!/^sub-[0-9a-f]{12}$/.test(id)) problems.push(`a child id looks like ${JSON.stringify(id)}`);
    if (childId() === id) problems.push("two child ids collided");
    if (subagentResult("answer", "completed") !== "answer") problems.push("a plain result drifted");
    if (!subagentResult("half", "max_steps").includes("partial answer")) {
      problems.push("a step-limited result did not say it was partial");
    }
    if (!subagentResult("", "completed").includes("without a final message")) {
      problems.push("a silent subagent produced an empty tool result");
    }
    if (!limitRefusal(4).includes("do not retry")) problems.push("the limit refusal does not say not to retry");

    definition.setup?.({
      channel: undefined,
      config: {
        max_concurrent: 2,
        child_max_steps: 5,
        child_tools_deny: ["pwsh"],
        explore_tools: ["read"],
        general_system: "G",
        explore_system: "E",
      },
      capabilities: {},
    } as unknown as Wiring);

    const started: Array<Record<string, any>> = [];
    const opened: Array<{ text: string; reason: string } | { fail: string }> = [];
    let held: Promise<void> | null = null;
    let release: (() => void) | null = null;
    const letGo = (): void => {
      release?.();
    };
    const channel = {
      stream: async (_capability: string, _method: string, params: Record<string, any>) => {
        started.push(params);
        const outcome = opened.shift() ?? { text: "child answer", reason: "completed" };
        const gate = held;
        return {
          async *[Symbol.asyncIterator]() {
            if (gate !== null) await gate;
            if (!("fail" in outcome)) yield { type: "done", steps: 1, text: outcome.text, reason: outcome.reason };
            else throw new Error(outcome.fail);
          },
        };
      },
      call: async (capability: string, method: string) => {
        throw new Error(`unexpected ${capability}/${method}`);
      },
      publish: async () => {},
      log: () => {},
    };
    const ready = (signal: AbortSignal) =>
      ({
        channel,
        config: {},
        capabilities: {},
        capability: "tool.task",
        method: "run",
        caller: "agent-core",
        signal,
        stream: undefined,
      }) as unknown as Call;
    const fresh = new AbortController();
    const run = async (params: Record<string, unknown>, signal: AbortSignal = fresh.signal) =>
      await definition.methods.run?.(params, ready(signal));
    const ask = (over: Record<string, unknown> = {}) => ({
      prompt: "find the loader",
      description: "look for the loader",
      session_id: "p1",
      cwd: "E:\\proj",
      call_id: "c1",
      ...over,
    });
    const refused = async (
      params: Record<string, unknown>,
      why: string,
      signal: AbortSignal = fresh.signal,
    ): Promise<string> => {
      try {
        await run(params, signal);
        problems.push(`the tool accepted ${why}`);
        return "";
      } catch (error) {
        return messageOf(error);
      }
    };

    const answer = await run(ask({ subagent_type: "explore" }));
    if (answer !== "child answer") problems.push(`a subagent answered ${JSON.stringify(answer)}`);
    const asked = started[0] ?? {};
    if (!/^sub-[0-9a-f]{12}$/.test(String(asked.session_id))) {
      problems.push(`the child session is ${JSON.stringify(asked.session_id)}`);
    }
    if (asked.origin?.parent_session_id !== "p1" || asked.origin.parent_call_id !== "c1") {
      problems.push(`the origin is ${JSON.stringify(asked.origin)}`);
    }
    if (asked.origin.type !== "explore" || asked.origin.description !== "look for the loader") {
      problems.push(`the origin label is ${JSON.stringify(asked.origin)}`);
    }
    if (asked.input !== "find the loader" || asked.cwd !== "E:\\proj") {
      problems.push(`the prompt or the directory drifted: ${JSON.stringify([asked.input, asked.cwd])}`);
    }
    if (asked.system !== "E" || asked.tools_allow?.join(",") !== "read" || asked.max_steps !== 5) {
      problems.push(`the child plan drifted: ${JSON.stringify([asked.system, asked.tools_allow, asked.max_steps])}`);
    }
    if (asked.tools_deny?.join(",") !== "task,pwsh") {
      problems.push(`the child denials are ${JSON.stringify(asked.tools_deny)}`);
    }

    opened.push({ text: "half", reason: "max_steps" });
    if (!String(await run(ask())).includes("partial answer")) problems.push("a step-limited child did not say so");
    if (started[1]?.tools_allow !== null || started[1]?.system !== "G") {
      problems.push(`a general child planned ${JSON.stringify([started[1]?.tools_allow, started[1]?.system])}`);
    }
    opened.push({ fail: "the stream broke" });
    const broke = await refused(ask(), "a failed child");
    if (!broke.includes("failed before it answered") || !broke.includes("the stream broke")) {
      problems.push(`a failed child said ${JSON.stringify(broke)}`);
    }
    const cancelled = new AbortController();
    cancelled.abort();
    opened.push({ text: "too late", reason: "completed" });
    const gone = await refused(ask(), "a cancelled child", cancelled.signal);
    if (!gone.includes("cancelled")) problems.push(`a cancelled child said ${JSON.stringify(gone)}`);
    await refused(ask({ prompt: "   " }), "a blank prompt");
    await refused(ask({ description: "" }), "a blank description");
    await refused(ask({ subagent_type: "deep" }), "an unknown type");

    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    opened.push({ text: "first", reason: "completed" });
    opened.push({ text: "second", reason: "completed" });
    const side = [run(ask()), run(ask())];
    await new Promise((resolve) => setTimeout(resolve, 0));
    const over = await refused(ask(), "a third subagent past the cap");
    if (!over.includes("do not retry") || !over.includes("2 subagents are already running")) {
      problems.push(`the cap said ${JSON.stringify(over)}`);
    }
    const parked = held;
    letGo();
    await Promise.all(side);
    held = null;
    if (String(await run(ask())) !== "child answer") {
      problems.push("a finished subagent did not free its seat");
    }
    if (parked === null) problems.push("the cap test never parked a subagent");
    return problems;
  },
};

runPlugin(definition);
