#!/usr/bin/env node
import { defineTools, packageVersion, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import type { ShellRunResult } from "@maota/shell";

import {
  needsApproval,
  reasonOf,
  refusalOf,
  requestApproval,
  type ApprovalTarget,
  type SubagentRef,
} from "./approval.ts";
import { renderPwshResult } from "./result.ts";

const DEFAULTS = { approval_timeout_ms: 300_000 };

let settings = { ...DEFAULTS };

const pwsh = { capability: "tool.pwsh" } as unknown as Call;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/// The gate is only as good as the policy it reads, so a policy that cannot be
/// read is read as the mode that asks: an absent or broken permission
/// capability must never turn a destructive command into a free pass.
async function modeOf(call: Call, sessionId: string, cwd: string): Promise<string> {
  try {
    const reply = (await call.channel.call(
      "permission",
      "policy",
      { session_id: sessionId, cwd },
      { signal: call.signal },
    )) as { mode?: unknown } | null;
    return typeof reply?.mode === "string" ? reply.mode : "ask";
  } catch {
    return "ask";
  }
}

const VERSION = packageVersion(import.meta.url);

const toolkit = defineTools([
  {
    capability: "tool.pwsh",
    version: VERSION,
    description:
      "Run a PowerShell command in the working directory and return its exit code, stdout and stderr. " +
      "A command the permission gate treats as destructive needs approval before it runs.",
    parameters: {
      command: { type: "string", required: true, description: "The PowerShell command line to run." },
      timeout_ms: { type: "integer", description: "Kill the command after this many milliseconds." },
      workdir: { type: "string", host: "session_cwd", description: "The session working directory." },
      session_id: { type: "string", host: "session_id", description: "The session this call belongs to." },
      call_id: {
        type: "string",
        host: "call_id",
        description: "The id of this tool call, so an approval can be matched to it.",
      },
      subagent: {
        type: "object",
        host: "subagent",
        description: "The subagent asking, when a subagent rather than the session made this call.",
      },
    },
    concurrency: "never",
    run: async (args, call) => {
      const command = String(args.command ?? "");
      const cwd = String(args.workdir ?? "");
      const sessionId = String(args.session_id ?? "");
      const callId = typeof args.call_id === "string" && args.call_id !== "" ? args.call_id : undefined;
      const subagent =
        typeof args.subagent === "object" && args.subagent !== null ? (args.subagent as SubagentRef) : undefined;
      const mode = await modeOf(call, sessionId, cwd);
      if (mode !== "full" && needsApproval(command)) {
        const target: ApprovalTarget = {
          session_id: sessionId,
          cwd,
          tool: "pwsh",
          ...(callId === undefined ? {} : { call_id: callId }),
          reason: reasonOf(command),
          ...(subagent === undefined ? {} : { subagent }),
        };
        const outcome = await requestApproval(call, target, settings.approval_timeout_ms);
        if (outcome !== "allowed-once") return refusalOf(command, outcome);
      }
      const raw = (await call.channel.call(
        "shell",
        "run",
        {
          command,
          workdir: cwd,
          ...(typeof args.timeout_ms === "number" ? { timeout_ms: args.timeout_ms } : {}),
        },
        { signal: call.signal },
      )) as ShellRunResult;
      return renderPwshResult(raw);
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  requires: [
    { capability: "shell", version: "^1" },
    { capability: "permission", version: "^1", optional: true },
  ],
  configKeys: ["approval_timeout_ms"],

  setup(wiring) {
    settings = { approval_timeout_ms: positive(wiring.config.approval_timeout_ms, DEFAULTS.approval_timeout_ms) };
  },

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];

    if (!needsApproval("rm -rf build") || !needsApproval("echo x > /etc/hosts") || !needsApproval("chmod 777 .")) {
      problems.push("one of the three destructive shapes was not recognized");
    }
    if (needsApproval("Get-ChildItem")) problems.push("an ordinary command was called destructive");

    const capabilities = toolkit.provides.map((item) => item.capability);
    if (capabilities.join(",") !== "tool.pwsh") problems.push(`the toolkit provides ${capabilities.join(", ")}`);
    const described = toolkit.methods.describe({}, { capability: "tool.pwsh" } as unknown as Call) as {
      name?: string;
      input_schema?: { properties?: Record<string, unknown>; required?: string[] };
      host_args?: Array<{ name: string; source: string }>;
    };
    if (described.name !== "pwsh") problems.push(`the tool is named ${JSON.stringify(described.name)}`);
    const properties = described.input_schema?.properties ?? {};
    if (Object.hasOwn(properties, "workdir")) problems.push("the spec exposes the host working directory");
    if (Object.hasOwn(properties, "session_id")) problems.push("the spec exposes the session id");
    if (Object.hasOwn(properties, "call_id")) problems.push("the spec exposes the tool call id");
    if (!Object.hasOwn(properties, "command")) problems.push("the spec lost the command parameter");
    if (described.input_schema?.required?.join(",") !== "command") {
      problems.push(`the spec requires ${JSON.stringify(described.input_schema?.required)}`);
    }
    const hostArgs = (described.host_args ?? []).map((item) => `${item.name}:${item.source}`).join(",");
    if (hostArgs !== "workdir:session_cwd,session_id:session_id,call_id:call_id,subagent:subagent") {
      problems.push(`the spec declares host args ${JSON.stringify(described.host_args)}`);
    }
    const policy = toolkit.methods.policy({}, { capability: "tool.pwsh" } as unknown as Call);
    if ((policy as { concurrency?: string }).concurrency !== "never") {
      problems.push(`the tool reports concurrency ${JSON.stringify(policy)}`);
    }
    const verdict = (await toolkit.methods.classify({ command: "Get-Date", workdir: "." }, pwsh)) as {
      safe?: boolean;
    };
    if (verdict.safe !== false) problems.push(`pwsh reported concurrency safety ${JSON.stringify(verdict)}`);

    interface CallRecord {
      capability: string;
      method: string;
    }
    interface Probe {
      log: CallRecord[];
      result: unknown;
    }
    const probe = async (mode: string, command: string, answer: () => unknown): Promise<Probe> => {
      const log: CallRecord[] = [];
      const channel = {
        call: async (capability: string, method: string): Promise<unknown> => {
          log.push({ capability, method });
          if (capability === "permission" && method === "policy") return { mode };
          if (capability === "permission" && method === "request") return answer();
          if (capability === "shell" && method === "run") {
            return {
              command,
              exit_code: 0,
              signal: null,
              timed_out: false,
              truncated: false,
              stdout: "ran\n",
              stderr: "",
            };
          }
          throw new Error(`no ${capability}/${method} here`);
        },
      };
      const result = await toolkit.methods.run(
        { command, workdir: "E:\\work", session_id: "s1", call_id: "c1" },
        { capability: "tool.pwsh", signal: new AbortController().signal, channel } as unknown as Call,
      );
      return { log, result };
    };
    const asked = (found: Probe): boolean =>
      found.log.some((item) => item.capability === "permission" && item.method === "request");
    const ran = (found: Probe): boolean =>
      found.log.some((item) => item.capability === "shell" && item.method === "run");

    const denied = await probe("ask", "rm -rf /tmp/x", () => ({ outcome: "rejected" }));
    const refusal = denied.result as { command?: string; status?: string; ok?: boolean; reason?: string };
    if (refusal.status !== "approval denied" || refusal.ok !== false) {
      problems.push(`a rejected command answered ${JSON.stringify(denied.result)}`);
    }
    if (refusal.command !== "rm -rf /tmp/x") problems.push(`the refusal lost the command line`);
    if (typeof refusal.reason !== "string" || !refusal.reason.includes("rejected")) {
      problems.push(`the refusal reason is ${JSON.stringify(refusal.reason)}`);
    }
    if (!asked(denied)) problems.push("a destructive command never asked for approval");
    if (ran(denied)) problems.push("a rejected command still reached the shell capability");
    if (denied.log[0]?.method !== "policy") problems.push("the tool did not read the policy first");

    const granted = await probe("ask", "rm -rf /tmp/x", () => ({ outcome: "allowed-once" }));
    if (!ran(granted)) problems.push("an approved command never ran");
    const ok = granted.result as { status?: string; ok?: boolean; stdout?: string };
    if (ok.status !== "exit 0" || ok.ok !== true || ok.stdout !== "ran\n") {
      problems.push(`an approved command reported ${JSON.stringify(granted.result)}`);
    }

    const unanswered = await probe("ask", "rm -rf /tmp/x", () => ({ outcome: "unavailable" }));
    if (ran(unanswered)) problems.push("a question with no answerer still ran the command");
    if ((unanswered.result as { reason?: string }).reason?.includes("no approval answerer") !== true) {
      problems.push(`an unanswered question said ${JSON.stringify(unanswered.result)}`);
    }

    const nonsense = await probe("ask", "rm -rf /tmp/x", () => ({ outcome: "sure" }));
    if (ran(nonsense)) problems.push("an answer outside the vocabulary still ran the command");

    const absent = await (async () => {
      const log: CallRecord[] = [];
      const channel = {
        call: async (capability: string, method: string): Promise<unknown> => {
          log.push({ capability, method });
          throw new Error(`no ${capability}/${method} here`);
        },
      };
      const result = await toolkit.methods.run(
        { command: "rm -rf /tmp/x", workdir: "E:\\work", session_id: "s1", call_id: "c1" },
        { capability: "tool.pwsh", signal: new AbortController().signal, channel } as unknown as Call,
      );
      return { log, result };
    })();
    if (absent.log.some((item) => item.capability === "shell")) {
      problems.push("a missing permission capability still ran the command");
    }
    if ((absent.result as { status?: string }).status !== "approval denied") {
      problems.push(`a missing permission capability answered ${JSON.stringify(absent.result)}`);
    }

    const automatic = await probe("auto", "rm -rf /tmp/x", () => ({ outcome: "allowed-once" }));
    if (!ran(automatic)) problems.push("the auto policy did not run the command");

    const unfettered = await probe("full", "rm -rf /tmp/x", () => ({ outcome: "unavailable" }));
    if (!ran(unfettered)) problems.push("the full policy did not run the command");
    if (asked(unfettered)) problems.push("the full policy still asked for approval");
    if (unfettered.log[0]?.method !== "policy") problems.push("the full policy was not read before running");

    const harmless = await probe("ask", "Get-ChildItem", () => ({ outcome: "unavailable" }));
    if (!ran(harmless)) problems.push("an ordinary command did not run");
    if (asked(harmless)) problems.push("an ordinary command asked for approval");

    const refused = await (async () => {
      try {
        await toolkit.methods.run({ command: "Get-Date" }, pwsh);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    if (typeof refused !== "string" || !refused.includes("arguments.workdir is required")) {
      problems.push(`run without a session directory said ${JSON.stringify(refused)}`);
    }

    const carried = await (async () => {
      let asked: Record<string, unknown> | null = null;
      const channel = {
        call: async (capability: string, method: string, params?: unknown): Promise<unknown> => {
          if (capability === "permission" && method === "policy") return { mode: "ask" };
          if (capability === "permission" && method === "request") {
            asked = params as Record<string, unknown>;
            return { outcome: "rejected" };
          }
          throw new Error(`no ${capability}/${method} here`);
        },
      };
      await toolkit.methods.run(
        {
          command: "rm -rf /tmp/x",
          workdir: "E:\\work",
          session_id: "p1",
          call_id: "c1",
          subagent: { id: "sub-1", type: "explore", description: "look" },
        },
        { capability: "tool.pwsh", signal: new AbortController().signal, channel } as unknown as Call,
      );
      return asked as Record<string, unknown> | null;
    })();
    if (carried?.session_id !== "p1" || carried.call_id !== "c1") {
      problems.push(`a subagent's question carried ${JSON.stringify(carried)}`);
    }
    if ((carried?.subagent as SubagentRef | undefined)?.id !== "sub-1") {
      problems.push("the subagent label was lost before the gate");
    }
    return problems;
  },
};

runPlugin(definition);
