#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { CallError, runPlugin, type Call, type Definition, type ToolPolicy } from "@maota/plugin-kit";

import { discover, sorted, type ToolRoute } from "./registry.ts";

const DEFAULTS = { max_result_chars: 20000, preview_chars: 2000 };

function defaultSpillDir(): string {
  const home = process.env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "tmp", "tool-results");
}

let settings = { ...DEFAULTS, spill_dir: defaultSpillDir() };
let tools = new Map<string, ToolRoute>();

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function render(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

function budgetOf(policy: ToolPolicy | null): number | null {
  const declared = policy?.max_result_chars;
  return declared === undefined ? settings.max_result_chars : declared;
}

function spill(text: string, budget: number): { spilled: true; path: string; chars: number; preview: string } {
  mkdirSync(settings.spill_dir, { recursive: true, mode: 0o700 });
  const path = join(settings.spill_dir, `${randomUUID()}.txt`);
  writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  return {
    spilled: true,
    path,
    chars: text.length,
    preview: text.slice(0, Math.max(0, Math.min(settings.preview_chars, budget))),
  };
}

async function policyOf(tool: ToolRoute, ctx: Call): Promise<ToolPolicy | null> {
  try {
    const reply = await ctx.channel.call(tool.capability, "policy", {}, { signal: ctx.signal });
    return reply === undefined || reply === null ? null : (reply as ToolPolicy);
  } catch (error) {
    ctx.channel.log("warn", `tool ${tool.name} policy failed`, { error: message(error) });
    return null;
  }
}

export const definition: Definition = {
  provides: [{ capability: "tools", version: "1.1.0" }],
  configKeys: ["max_result_chars", "preview_chars", "spill_dir"],

  setup(wiring) {
    settings = {
      max_result_chars: positive(wiring.config.max_result_chars, DEFAULTS.max_result_chars),
      preview_chars: positive(wiring.config.preview_chars, DEFAULTS.preview_chars),
      spill_dir:
        typeof wiring.config.spill_dir === "string" && wiring.config.spill_dir.trim() !== ""
          ? wiring.config.spill_dir
          : defaultSpillDir(),
    };
  },

  start(wiring) {
    tools = discover(wiring.capabilities);
    wiring.channel.log("info", `tools: ${[...tools.keys()].join(", ") || "(none)"}`, { count: tools.size });
  },

  methods: {
    async list(_params, ctx) {
      const listed: unknown[] = [];
      for (const tool of sorted(tools)) {
        try {
          const spec = await ctx.channel.call(tool.capability, "describe", {}, { signal: ctx.signal });
          tool.policy = await policyOf(tool, ctx);
          listed.push({ ...(spec as Record<string, unknown>), capability: tool.capability });
        } catch (error) {
          ctx.channel.log("warn", `tool ${tool.name} describe failed`, { error: message(error) });
        }
      }
      return { tools: listed };
    },

    async call(params, ctx) {
      const name = String(params?.name ?? "");
      const tool = tools.get(name);
      if (!tool) throw new CallError(-32602, `no such tool: ${name}`);
      const result = await ctx.channel.call(tool.capability, "run", params?.args ?? {}, { signal: ctx.signal });
      const budget = budgetOf(tool.policy);
      if (budget === null) return result;
      const text = render(result);
      return text.length <= budget ? result : spill(text, budget);
    },

    async classify(params, ctx) {
      const name = String(params?.name ?? "");
      const tool = tools.get(name);
      if (!tool) throw new CallError(-32602, `no such tool: ${name}`);
      const policy = tool.policy;
      if (policy === null) return { safe: false };
      if (policy.concurrency === "always") return { safe: true };
      if (policy.concurrency === "never") return { safe: false };
      try {
        const reply = await ctx.channel.call(tool.capability, "classify", params?.args ?? {}, { signal: ctx.signal });
        return { safe: (reply as { safe?: unknown } | null)?.safe === true };
      } catch {
        return { safe: false };
      }
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const found = discover({
      "tool.pwsh": { plugin: "pwsh-local", version: "1.0.0" },
      api: { plugin: "api", version: "1.0.0" },
      "tool.read": { plugin: "tool-fs", version: "1.0.0" },
    });
    if (found.size !== 2) problems.push(`discover picked ${found.size} tools, expected 2`);
    if (!found.has("pwsh")) problems.push("discover lost tool.pwsh");
    if (!found.has("read")) problems.push("discover lost tool.read");
    if (sorted(found).map((tool) => tool.name).join(",") !== "pwsh,read") {
      problems.push("sorted lost the order");
    }
    if (budgetOf(null) !== DEFAULTS.max_result_chars) problems.push("an undeclared budget did not fall back");
    if (budgetOf({ concurrency: "always", max_result_chars: null }) !== null) {
      problems.push("null did not mean never spill");
    }
    if (budgetOf({ concurrency: "always", max_result_chars: 5 }) !== 5) problems.push("a declared budget was ignored");
    if (render("x") !== "x" || render({ a: 1 }) !== '{"a":1}' || render(undefined) !== "null") {
      problems.push("render drifted");
    }
    const dir = settings.spill_dir;
    settings.spill_dir = join(tmpdir(), `maota-spill-${randomUUID()}`);
    try {
      const spilled = spill("x".repeat(100), 10);
      if (spilled.chars !== 100) problems.push("spill lost the char count");
      if (spilled.preview.length !== 10) problems.push(`spill previewed ${spilled.preview.length} chars`);
      if (!existsSync(spilled.path)) problems.push("spill wrote no file");
      else if (readFileSync(spilled.path, "utf8").length !== 100) problems.push("spill wrote the wrong text");
    } finally {
      rmSync(settings.spill_dir, { recursive: true, force: true });
      settings.spill_dir = dir;
    }
    return problems;
  },
};

runPlugin(definition);
