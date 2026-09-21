#!/usr/bin/env node
import { runPlugin, type Definition } from "@maota/plugin-kit";
import type { HookDescription, PreToolUsePayload, StopPayload, UserPromptSubmitPayload } from "@maota/hook-protocol";

/// The word that makes this fixture refuse a command, and the one that makes it
/// refuse a prompt: the end to end test needs both, and needs a command that
/// only the permission gate stops.
const DENY = "MAOTA_HOOK_DENY";
const REFUSE = "MAOTA_HOOK_REFUSE";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const definition: Definition = {
  provides: [{ capability: "hook.deny", version: "1.0.0" }],
  configKeys: [],

  methods: {
    describe(): HookDescription {
      return { events: ["UserPromptSubmit", "PreToolUse", "Stop"] };
    },

    UserPromptSubmit(payload: UserPromptSubmitPayload) {
      const input = text(payload?.input);
      return input.includes(REFUSE)
        ? { decision: "deny", reason: "the deny hook refused this prompt" }
        : null;
    },

    PreToolUse(payload: PreToolUsePayload) {
      const command = text((payload?.args as { command?: unknown })?.command);
      if (command.includes(DENY)) return { decision: "deny", reason: `hook.deny refused: ${command}` };
      // An allowance on purpose: the gate underneath must still decide.
      return { decision: "allow", context: [`hook.deny allowed ${text(payload?.tool)}`] };
    },

    Stop(payload: StopPayload) {
      return {
        context: [`stop_active=${String(payload?.stop_active === true)}`],
        steer: "say one more thing",
      };
    },
  },
};

runPlugin(definition);
