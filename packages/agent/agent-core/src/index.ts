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
import { runSelfCheck } from "./selfcheck.ts";

export { LEVELS, isLevel, readLevel, readThinking, resolveLevel } from "./levels.ts";
export type { Level, LevelSetting } from "./levels.ts";
export { titleOf } from "./history.ts";
export type { SubagentOrigin } from "./subagent.ts";

export const definition: Definition = {
  provides: ["agent.loop"],
  configKeys: [
    "max_steps",
    "max_parallel_tools",
    "compact_after_chars",
    "compact_keep_messages",
    "max_depth",
    "thinking",
  ],
  requires: [
    { capability: "api" },
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
  },

  async selfCheck() {
    return runSelfCheck(definition);
  },
};

runPlugin(definition);
