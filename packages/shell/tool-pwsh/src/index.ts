#!/usr/bin/env node
import { defineTools, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import type { ShellRunResult } from "@maota/shell";

import { renderPwshResult } from "./result.ts";

const pwsh = { capability: "tool.pwsh" } as unknown as Call;

const toolkit = defineTools([
  {
    capability: "tool.pwsh",
    version: "1.0.0",
    description:
      "Run a PowerShell command in the working directory and return its exit code, stdout and stderr.",
    parameters: {
      command: { type: "string", required: true, description: "The PowerShell command line to run." },
      timeout_ms: { type: "integer", description: "Kill the command after this many milliseconds." },
      workdir: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "never",
    run: async (args, call) => {
      const raw = (await call.channel.call(
        "shell",
        "run",
        {
          command: args.command,
          workdir: args.workdir,
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
  requires: [{ capability: "shell", version: "^1" }],
  configKeys: [],

  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
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
    if (!Object.hasOwn(properties, "command")) problems.push("the spec lost the command parameter");
    if (described.input_schema?.required?.join(",") !== "command") {
      problems.push(`the spec requires ${JSON.stringify(described.input_schema?.required)}`);
    }
    const hostArgs = (described.host_args ?? []).map((item) => `${item.name}:${item.source}`).join(",");
    if (hostArgs !== "workdir:session_cwd") {
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
    const stdout = "hi\n";
    const forwarded = (await toolkit.methods.run(
      { command: "Write-Output hi", workdir: "." },
      {
        capability: "tool.pwsh",
        signal: new AbortController().signal,
        channel: {
          call: async (): Promise<ShellRunResult> => ({
            command: "Write-Output hi",
            exit_code: 0,
            signal: null,
            timed_out: false,
            truncated: false,
            stdout,
            stderr: "",
          }),
        },
      } as unknown as Call,
    )) as { status?: string; ok?: boolean; stdout?: string };
    if (forwarded.status !== "exit 0" || forwarded.ok !== true || forwarded.stdout !== stdout) {
      problems.push(`the tool forwarded ${JSON.stringify(forwarded)}`);
    }
    const refused = await (async () => {
      try {
        await toolkit.methods.run({ command: "Get-Date" }, pwsh);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    if (refused !== "invalid arguments: arguments.workdir is required") {
      problems.push(`run without a session directory said ${JSON.stringify(refused)}`);
    }
    return problems;
  },
};

runPlugin(definition);