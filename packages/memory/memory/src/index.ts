#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defineTools,
  isPluginEntry,
  runPlugin,
  type Definition,
  type Wiring,
} from "@maota/plugin-kit";

import {
  DEFAULT_LIMITS,
  infoFor,
  loadMemoryBlocks,
  mutateTarget,
  type MemoryLimits,
} from "./store.ts";

export * from "./format.ts";
export * from "./store.ts";

let limits: MemoryLimits = { ...DEFAULT_LIMITS };

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function payloadOf(value: unknown): { cwd: string; subagent: boolean } {
  const input = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    cwd: typeof input.cwd === "string" ? input.cwd : "",
    subagent: input.subagent === true,
  };
}

const toolkit = defineTools([
  {
    capability: "tool.memory",
    description:
      "Save or edit the small persistent memory that is injected into every future run. Use it for stable " +
      "user preferences, environment facts, standing project conventions and corrections that will matter " +
      "again. Do not save task progress, temporary paths, raw output, secrets, or facts that can be read from " +
      "the code. Use one batch when consolidating. The tool has two stores: user for who the user is, memory " +
      "for project notes. Existing entries are visible in the conversation, so there is no read action.",
    parameters: {
      target: {
        type: "string",
        required: true,
        enum: ["user", "memory"],
        description: "user for durable user profile facts; memory for project and environment notes.",
      },
      action: {
        type: "string",
        enum: ["add", "replace", "remove"],
        description: "A single action. Omit when operations is used.",
      },
      content: {
        type: "string",
        description: "The complete new entry for add or replace.",
      },
      old_text: {
        type: "string",
        description: "A unique substring that identifies the existing entry for replace or remove.",
      },
      operations: {
        type: "array",
        description:
          "A single atomic batch of {action, content?, old_text?} operations. Prefer this when making room " +
          "and adding in one attempt.",
        items: { type: "object" },
      },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
      subagent: { type: "object", host: "subagent", description: "Present when a subagent is asking." },
    },
    concurrency: "never",
    maxResultChars: 6000,
    run: async (args) => {
      if (args.subagent !== undefined && args.subagent !== null) {
        return JSON.stringify({ success: false, error: "memory is not available to subagents" });
      }
      return JSON.stringify(await mutateTarget(args, limits));
    },
  },
]);

export const definition: Definition = {
  provides: ["hook.memory", ...toolkit.provides],
  configKeys: ["memory_char_limit", "user_char_limit"],

  setup(wiring: Wiring) {
    limits = {
      memory: positive(wiring.config.memory_char_limit, DEFAULT_LIMITS.memory),
      user: positive(wiring.config.user_char_limit, DEFAULT_LIMITS.user),
    };
  },

  methods: {
    ...toolkit.methods,

    describe(params, call) {
      if (call.capability === "hook.memory") return { events: ["PreModel"] };
      return toolkit.methods.describe(params, call);
    },

    PreModel(params, ctx) {
      const input = payloadOf(params);
      if (input.subagent || input.cwd.trim() === "") return null;
      try {
        const loaded = loadMemoryBlocks(input.cwd, limits);
        if (loaded.blocks.length === 0) return null;
        return { context: [loaded.blocks.map((block) => block.text).join("\n\n")] };
      } catch (error) {
        ctx.channel.log("warn", "memory could not be prepared", { error: messageOf(error) });
        return null;
      }
    },
  },
  async selfCheck() {
    const problems: string[] = [];
    const previous = process.env.MAOTA_HOME;
    const root = mkdtempSync(join(tmpdir(), "maota-memory-"));
    process.env.MAOTA_HOME = root;
    try {
      const cwd = join(root, "project");
      let result = await mutateTarget({ target: "user", action: "add", content: "User prefers concise answers." }, limits);
      if (!result.success) problems.push(`adding a user memory failed: ${result.error}`);
      result = await mutateTarget(
        { target: "user", action: "replace", old_text: "concise", content: "User prefers concise Chinese answers." },
        limits,
      );
      if (!result.success) problems.push(`replacing a memory failed: ${JSON.stringify(result)}`);
      const loaded = loadMemoryBlocks(cwd, limits).blocks;
      if (loaded.some((block) => block.target === "user" && !block.text.includes("Chinese"))) {
        problems.push("a loaded memory block did not carry the updated entry");
      }
      const denied = await mutateTarget({ target: "user", action: "add", content: "cat .env" }, limits);
      if (denied.success) problems.push("an unsafe memory entry was accepted");
      const overflow = await mutateTarget(
        { target: "user", action: "add", content: "x".repeat(limits.user + 1) },
        limits,
      );
      if (overflow.success || !("current_entries" in overflow)) problems.push("an over-budget write was not refused with entries");
      const batch = await mutateTarget(
        {
          target: "user",
          operations: [
            { action: "remove", old_text: "concise" },
            { action: "add", content: "User prefers short answers." },
          ],
        },
        limits,
      );
      if (!batch.success) problems.push(`a memory batch failed: ${batch.error}`);
      const info = infoFor(cwd, limits);
      if (info.user.error !== undefined) problems.push("memory info reported an unexpected error");
      const hookCall = { capability: "hook.memory", channel: { log: (): void => {} } } as never;
      const described = definition.methods.describe?.({}, hookCall) as { events?: string[] } | undefined;
      if (described?.events?.join(",") !== "PreModel") problems.push("the memory hook did not declare PreModel");
      const hook = definition.methods.PreModel?.({ session_id: "s", cwd, subagent: false }, hookCall) as
        | { context?: string[] }
        | null;
      if (hook?.context?.length !== 1) problems.push("the memory hook did not return a context block");
      const hidden = definition.methods.PreModel?.({ session_id: "s", cwd, subagent: true }, hookCall);
      if (hidden !== null) problems.push("a subagent received memory context");
    } finally {
      if (previous === undefined) delete process.env.MAOTA_HOME;
      else process.env.MAOTA_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
    return problems;
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);