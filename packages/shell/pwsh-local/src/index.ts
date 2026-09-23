#!/usr/bin/env node
import { CallError, runPlugin, type Definition } from "@maota/plugin-kit";

import { runPwsh } from "./pwsh.ts";

const DEFAULTS = {
  timeout_ms: 30_000,
  max_output_bytes: 64 * 1024,
};

interface Settings {
  timeout_ms: number;
  max_output_bytes: number;
  cwd: string | undefined;
}

let settings: Settings = { ...DEFAULTS, cwd: undefined };

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export const definition: Definition = {
  provides: ["shell"],
  configKeys: ["timeout_ms", "max_output_bytes", "cwd"],

  setup(wiring) {
    settings = {
      timeout_ms: positive(wiring.config.timeout_ms, DEFAULTS.timeout_ms),
      max_output_bytes: positive(wiring.config.max_output_bytes, DEFAULTS.max_output_bytes),
      cwd: typeof wiring.config.cwd === "string" && wiring.config.cwd.trim() !== "" ? wiring.config.cwd : undefined,
    };
  },

  methods: {
    async run(params, call) {
      const command = params?.command;
      if (typeof command !== "string" || command.trim() === "") {
        throw new CallError(-32602, "command must be a non-empty string");
      }
      const workdir = typeof params?.workdir === "string" && params.workdir !== "" ? params.workdir : settings.cwd;
      return await runPwsh({
        command,
        timeout_ms: positive(params?.timeout_ms, settings.timeout_ms),
        max_output_bytes: settings.max_output_bytes,
        cwd: workdir,
        signal: call.signal,
      });
    },
  },

  async selfCheck() {
    const result = await runPwsh({
      command: "Write-Output maota",
      timeout_ms: 10_000,
      max_output_bytes: 4096,
      cwd: undefined,
      signal: new AbortController().signal,
    });
    if (result.exit_code !== 0) return [`the self check command exited with code ${result.exit_code}`];
    if (!result.stdout.includes("maota")) return [`the self check printed ${JSON.stringify(result.stdout)}`];
    return [];
  },
};

runPlugin(definition);
