#!/usr/bin/env node
import { CallError, runPlugin, type Definition } from "../../plugin-kit/src/index.ts";
import { runCommand } from "./command.ts";
import { SPEC } from "./spec.ts";

const DEFAULTS = { timeout_ms: 30_000, max_output_bytes: 64 * 1024 };

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
  provides: [{ capability: "tool.shell", version: "1.0.0" }],
  configKeys: ["timeout_ms", "max_output_bytes", "cwd"],

  setup(wiring) {
    settings = {
      timeout_ms: positive(wiring.config.timeout_ms, DEFAULTS.timeout_ms),
      max_output_bytes: positive(wiring.config.max_output_bytes, DEFAULTS.max_output_bytes),
      cwd: typeof wiring.config.cwd === "string" ? wiring.config.cwd : undefined,
    };
  },

  methods: {
    describe: () => SPEC,

    async run(params, call) {
      const command = params?.command;
      if (typeof command !== "string" || command.trim() === "") {
        throw new CallError(-32602, "command must be a non-empty string");
      }
      const result = await runCommand(command, {
        cwd: typeof params?.cwd === "string" ? params.cwd : settings.cwd,
        timeout_ms: positive(params?.timeout_ms, settings.timeout_ms),
        max_output_bytes: settings.max_output_bytes,
        signal: call.signal,
      });
      return { tool: SPEC.name, ...result };
    },
  },

  async selfCheck() {
    const result = await runCommand("echo maota", { timeout_ms: 10_000, max_output_bytes: 4096, cwd: undefined });
    if (result.exit_code !== 0) return [`echo exited with code ${result.exit_code}`];
    if (!result.stdout.includes("maota")) return [`echo printed ${JSON.stringify(result.stdout)}`];
    return [];
  },
};

runPlugin(definition);
