#!/usr/bin/env node
import {
  defineTools,
  runPlugin,
  type Call,
  type Definition,
  type ToolPolicy,
  type Wiring,
} from "@maota/plugin-kit";

import {
  acknowledgement,
  checkTodos,
  verificationNudge,
  type PlanCounts,
  type PlanLimits,
  type PlanView,
  type TodoItem,
} from "./todos.ts";

const DEFAULTS = { max_items: 64, max_content_chars: 400, verify_nudge: true, verify_min_items: 3 };

let settings = { ...DEFAULTS };

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

const limitsOf = (): PlanLimits => ({ max_items: settings.max_items, max_content_chars: settings.max_content_chars });

const toolkit = defineTools([
  {
    capability: "tool.todo_write",
    description:
      "Create and manage the task list for this session. Call it with the whole list, in order, every time: the " +
      "list replaces the one before it, so write the full plan back rather than describing a change. Keep the steps " +
      "you are actually working through, mark the step you are on as in_progress and the finished ones as completed, " +
      "and write an empty list to clear the plan. The list stays with the session until you replace it, so it is " +
      "still there in the next turn.",
    parameters: {
      todos: {
        type: "array",
        required: true,
        description: "The whole task list, in order. Every call replaces the previous list.",
        items: {
          type: "object",
          description: "One item: { content: string, status: pending | in_progress | completed }.",
        },
      },
      session_id: { type: "string", host: "session_id", description: "The session this list belongs to." },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "never",
    maxResultChars: 500,
    run: async (args, call) => {
      const todos = checkTodos(args.todos, limitsOf());
      const view = (await call.channel.call(
        "session",
        "save_todos",
        { id: args.session_id, cwd: args.cwd, todos },
        { signal: call.signal },
      )) as PlanView;
      const lines = [acknowledgement(view)];
      const nudge = verificationNudge(todos, settings);
      if (nudge !== null) lines.push(nudge);
      return lines.join("\n\n");
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  requires: [{ capability: "session" }],
  configKeys: ["max_items", "max_content_chars", "verify_nudge", "verify_min_items"],

  setup(wiring) {
    settings = {
      max_items: positive(wiring.config.max_items, DEFAULTS.max_items),
      max_content_chars: positive(wiring.config.max_content_chars, DEFAULTS.max_content_chars),
      verify_nudge: wiring.config.verify_nudge !== false,
      verify_min_items: positive(wiring.config.verify_min_items, DEFAULTS.verify_min_items),
    };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const call = { capability: "tool.todo_write" } as unknown as Call;

    const capabilities = toolkit.provides;
    if (capabilities.join(",") !== "tool.todo_write") problems.push(`the toolkit provides ${capabilities.join(", ")}`);
    const described = toolkit.methods.describe({}, call) as {
      name?: string;
      input_schema?: { properties?: Record<string, unknown>; required?: string[] };
      host_args?: Array<{ name: string; source: string }>;
    };
    if (described.name !== "todo_write") problems.push(`the tool is named ${JSON.stringify(described.name)}`);
    const published = Object.keys(described.input_schema?.properties ?? {}).join(",");
    if (published !== "todos") problems.push(`the spec publishes ${published}`);
    if (described.input_schema?.required?.join(",") !== "todos") {
      problems.push(`the spec requires ${JSON.stringify(described.input_schema?.required)}`);
    }
    const hostArgs = (described.host_args ?? []).map((item) => `${item.name}:${item.source}`).join(",");
    if (hostArgs !== "session_id:session_id,cwd:session_cwd") {
      problems.push(`the spec declares host args ${JSON.stringify(described.host_args)}`);
    }
    const policy = toolkit.methods.policy({}, call) as ToolPolicy;
    if (policy.concurrency !== "never") problems.push(`the tool reports concurrency ${JSON.stringify(policy)}`);
    if (policy.max_result_chars !== 500) {
      problems.push(`the tool reports max_result_chars ${String(policy.max_result_chars)}`);
    }
    const verdict = (await toolkit.methods.classify({ todos: [] }, call)) as { safe?: boolean };
    if (verdict.safe !== false) problems.push(`the tool reported concurrency safety ${JSON.stringify(verdict)}`);

    const countsOf = (todos: readonly TodoItem[]): PlanCounts => {
      const counts: PlanCounts = { pending: 0, in_progress: 0, completed: 0 };
      for (const todo of todos) counts[todo.status] += 1;
      return counts;
    };

    interface Sent {
      capability: string;
      method: string;
      params: Record<string, unknown>;
    }
    const probe = async (
      todos: unknown,
    ): Promise<{ result: unknown; sent: Sent[]; error: string }> => {
      const sent: Sent[] = [];
      const ctx = {
        capability: "tool.todo_write",
        signal: new AbortController().signal,
        channel: {
          call: async (capability: string, method: string, params: Record<string, unknown>) => {
            sent.push({ capability, method, params });
            const list = Array.isArray(params.todos) ? (params.todos as TodoItem[]) : [];
            return {
              revision: 3,
              updated_at: "2026-01-01T00:00:00.000Z",
              todos: list,
              counts: countsOf(list),
            };
          },
          log: () => {},
        },
      } as unknown as Call;
      try {
        const result = await toolkit.methods.run({ todos, session_id: "s1", cwd: "E:\\proj" }, ctx);
        return { result, sent, error: "" };
      } catch (error) {
        return { result: null, sent, error: error instanceof Error ? error.message : String(error) };
      }
    };

    const plan: TodoItem[] = [
      { content: "read the parser", status: "completed" },
      { content: "rename the callers", status: "in_progress" },
    ];
    const written = await probe(plan);
    if (written.error !== "") problems.push(`a valid write failed: ${written.error}`);
    if (written.sent.length !== 1) problems.push(`a valid write made ${written.sent.length} capability calls`);
    const first = written.sent[0];
    if (first?.capability !== "session" || first?.method !== "save_todos") {
      problems.push(`the write went to ${String(first?.capability)}.${String(first?.method)}`);
    }
    if (JSON.stringify(first?.params) !== JSON.stringify({ id: "s1", cwd: "E:\\proj", todos: plan })) {
      problems.push(`the write sent ${JSON.stringify(first?.params)}`);
    }
    if (String(written.result) !== "plan updated: 2 tasks, 0 pending, 1 in progress, 1 completed (revision 3)") {
      problems.push(`the write answered ${JSON.stringify(written.result)}`);
    }

    const finished = await probe([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "completed" },
    ]);
    if (!String(finished.result).includes("verify it")) problems.push("a finished list carried no verification nudge");
    const pair = await probe([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
    ]);
    if (String(pair.result).includes("verify it")) problems.push("a two item list carried a verification nudge");
    const open = await probe([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "pending" },
    ]);
    if (String(open.result).includes("verify it")) problems.push("a list with work left carried a verification nudge");
    const cleared = await probe([]);
    if (cleared.error !== "" || !String(cleared.result).startsWith("plan updated: 0 tasks")) {
      problems.push(`clearing the plan answered ${JSON.stringify(cleared.result)}`);
    }

    const extra = await probe([{ content: "ok", status: "done", activeForm: "doing it" }]);
    if (extra.sent.length !== 0) problems.push("a refused list still reached the session");
    if (!extra.error.includes("todos[0].activeForm is not part of a todo item")) {
      problems.push(`an extra field was reported as ${extra.error}`);
    }
    if (!extra.error.includes("todos[0].status must be one of")) {
      problems.push(`a bad status was reported as ${extra.error}`);
    }
    const two = await probe([
      { content: "ok", status: "done" },
      { content: "   ", status: "pending" },
    ]);
    if (!two.error.includes("todos[0].status") || !two.error.includes("todos[1].content must not be blank")) {
      problems.push(`two broken items were reported as ${two.error}`);
    }
    const many = await probe(
      Array.from({ length: DEFAULTS.max_items + 1 }, (_, n) => ({ content: `step ${n}`, status: "pending" })),
    );
    if (!many.error.includes(`over the max_items of ${DEFAULTS.max_items}`)) {
      problems.push(`an over long list was reported as ${many.error}`);
    }
    const long = await probe([{ content: "x".repeat(DEFAULTS.max_content_chars + 1), status: "pending" }]);
    if (!long.error.includes(`over the max_content_chars of ${DEFAULTS.max_content_chars}`)) {
      problems.push(`a long item was reported as ${long.error}`);
    }

    definition.setup?.({ config: { max_items: 1, verify_nudge: false } } as unknown as Wiring);
    const tuned = await probe([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
    ]);
    if (tuned.error === "") problems.push("the configured max_items was ignored");
    const quiet = await probe([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "completed" },
    ]);
    if (String(quiet.result).includes("verify it")) problems.push("verify_nudge = false still nudged");
    definition.setup?.({ config: {} } as unknown as Wiring);
    const restored = await probe(plan);
    if (restored.error !== "") problems.push(`the defaults did not come back: ${restored.error}`);

    return problems;
  },
};

runPlugin(definition);
