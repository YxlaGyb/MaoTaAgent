#!/usr/bin/env node
/// The agent loop plugin as a deployment sees it: what it provides, the config
/// keys it reads, the capabilities it needs, and the five members — setup,
/// start, run, info and selfCheck — each of which delegates to the module that
/// owns it. The level surface is re-exported for whoever configures a run, and
/// `definition` is the whole of what `runPlugin` serves.

import { runPlugin, type Definition } from "@maota/plugin-kit";
import { startCapabilities } from "./hooks.ts";
import { applyConfig, infoOf } from "./levels.ts";
import { runAgent } from "./run.ts";
import { compactSession, contextOf } from "./history.ts";
import { runSelfCheck } from "./selfcheck.ts";

export { LEVELS, isLevel, readLevel, readThinking, resolveLevel } from "./levels.ts";
export type { Level, LevelSetting } from "./levels.ts";
export { titleOf } from "./history.ts";
export type { SubagentOrigin } from "./subagent.ts";

export const definition: Definition = {
  provides: ["agent.loop"],
  hostCalls: [],
  registrations: [],
  configKeys: [
    "max_steps",
    "max_parallel_tools",
    "context_chars",
    "compact_after_chars",
    "compact_keep_messages",
    "context_compact",
    "max_compactions",
    "max_depth",
    "thinking",
    "model_budgets",
  ],
  injects: [
    { capability: "model" },
    { capability: "tools" },
    { capability: "session" },
    { capability: "system-prompt" },
    { capability: "skill", optional: true },
    { capability: "permission", optional: true },
    { capability: "hooks", optional: true },
  ],

  setup(wiring) {
    applyConfig(wiring);
  },

  /// The hook engine is optional by design: a deployment without it simply has
  /// no hooks, and asking a capability nobody provides would keep this plugin
  /// from starting at all.
  start(wiring) {
    startCapabilities(wiring);
  },

  methods: {
    async run(params, ctx) {
      return runAgent(params, ctx);
    },

    info() {
      return infoOf();
    },
    context(params, ctx) {
      const sessionId = typeof params?.session_id === "string" ? params.session_id : "default";
      const cwd = typeof params?.cwd === "string" && params.cwd !== "" ? params.cwd : null;
      const model = typeof params?.model === "string" && params.model !== "" ? params.model : undefined;
      return contextOf(ctx, sessionId, cwd, model);
    },

    compact(params, ctx) {
      return compactSession(ctx, params);
    },
  },

  async selfCheck() {
    return runSelfCheck(definition);
  },
};

runPlugin(definition);
