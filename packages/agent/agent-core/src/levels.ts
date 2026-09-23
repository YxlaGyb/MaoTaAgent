/// The thinking levels a deployment configures and the settings that back them:
/// the level names, the table a run reads its model and tool surface from, and
/// the one place the deployment's `agent` config keys are applied. Every read
/// here is a read of a config value, so the plugin surface stays in `index.ts`
/// and only the table behind it lives here.

import { CallError, type Wiring } from "@maota/plugin-kit";

export const LEVELS = ["off", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export interface LevelSetting {
  model?: string;
  tools: boolean;
}

const DEFAULTS = {
  max_steps: 8,
  max_parallel_tools: 4,
  compact_after_chars: 120_000,
  compact_keep_messages: 12,
  max_depth: 3,
  thinking: {} as Partial<Record<Level, LevelSetting>>,
};

export let settings = { ...DEFAULTS };

/// The thinking level and model of every run that is in flight, keyed by the
/// session it is serving, so a subagent the run spawns inherits them: the loop
/// keeps no other link back to its parent.
export const active = new Map<string, LevelSetting>();

/// How deep the run that owns a session is. `active` answers "what may this
/// child do", this answers "how many delegations away is it", and both are
/// cleared when the run that wrote them ends.
export const depths = new Map<string, number>();

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function readLevel(value: unknown): Level {
  if (value === undefined || value === null || value === "") return "off";
  if (!isLevel(value)) {
    throw new CallError(-32602, `thinking must be one of ${LEVELS.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readThinking(value: unknown): Partial<Record<Level, LevelSetting>> {
  const out: Partial<Record<Level, LevelSetting>> = {};
  if (value === null || typeof value !== "object") return out;
  for (const level of LEVELS) {
    const raw = (value as Record<string, unknown>)[level];
    if (typeof raw === "string") {
      if (raw !== "") out[level] = { model: raw, tools: true };
    } else if (raw !== null && typeof raw === "object") {
      const table = raw as { model?: unknown; tools?: unknown };
      out[level] = {
        ...(typeof table.model === "string" && table.model !== "" ? { model: table.model } : {}),
        tools: table.tools !== false,
      };
    }
  }
  return out;
}

export function resolveLevel(thinking: Partial<Record<Level, LevelSetting>>, level: Level): LevelSetting {
  return thinking[level] ?? { tools: true };
}

/// The deployment's config, read once when the plugin is wired: every key falls
/// back to its default, and a value the deployment could not have meant is
/// treated as absent rather than obeyed.
export function applyConfig(wiring: Wiring): void {
  settings = {
    max_steps:
      typeof wiring.config.max_steps === "number" && wiring.config.max_steps > 0
        ? wiring.config.max_steps
        : DEFAULTS.max_steps,
    max_parallel_tools:
      typeof wiring.config.max_parallel_tools === "number" && wiring.config.max_parallel_tools > 0
        ? wiring.config.max_parallel_tools
        : DEFAULTS.max_parallel_tools,
    compact_after_chars:
      typeof wiring.config.compact_after_chars === "number" && wiring.config.compact_after_chars > 0
        ? wiring.config.compact_after_chars
        : DEFAULTS.compact_after_chars,
    compact_keep_messages:
      typeof wiring.config.compact_keep_messages === "number" && wiring.config.compact_keep_messages >= 0
        ? wiring.config.compact_keep_messages
        : DEFAULTS.compact_keep_messages,
    max_depth:
      typeof wiring.config.max_depth === "number" && wiring.config.max_depth >= 0
        ? wiring.config.max_depth
        : DEFAULTS.max_depth,
    thinking: readThinking(wiring.config.thinking),
  };
}

export function infoOf(): { levels: Level[]; thinking: Partial<Record<Level, LevelSetting>> } {
  return { levels: [...LEVELS], thinking: settings.thinking };
}
