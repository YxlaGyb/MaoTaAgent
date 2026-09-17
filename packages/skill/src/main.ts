#!/usr/bin/env node
import { CallError, runPlugin, type Call, type Channel, type Definition, type Wiring } from "../../plugin-kit/src/index.ts";

interface Skill {
  name: string;
  description: string;
}

let settings = { dirs: ["skills"] as string[] };
let skills: Skill[] = [];

async function rescan(wiring: Wiring, dirs: readonly string[]): Promise<Skill[]> {
  const reply = (await wiring.channel.call("skill.filesystem", "scan", { dirs })) as {
    skills?: Array<{ name?: unknown; description?: unknown }>;
  };
  return (reply?.skills ?? []).map((skill) => ({
    name: String(skill.name ?? ""),
    description: String(skill.description ?? ""),
  }));
}

export const definition: Definition = {
  provides: [{ capability: "skill", version: "1.0.0" }],
  requires: [{ capability: "skill.filesystem", version: "^1" }],
  configKeys: ["dirs"],

  setup(wiring) {
    settings = {
      dirs: Array.isArray(wiring.config.dirs)
        ? wiring.config.dirs.filter((dir): dir is string => typeof dir === "string")
        : settings.dirs,
    };
  },

  async start(wiring) {
    try {
      skills = await rescan(wiring, settings.dirs);
      wiring.channel.log("info", `skills: ${skills.map((skill) => skill.name).join(", ") || "(none)"}`, {
        count: skills.length,
      });
    } catch (error) {
      skills = [];
      wiring.channel.log("warn", "skill scan failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  methods: {
    list: () => ({ skills }),

    async load(params, ctx) {
      const name = String(params?.name ?? "");
      if (!skills.some((skill) => skill.name === name)) {
        throw new CallError(-32602, `unknown skill: ${name}`);
      }
      const reply = (await ctx.channel.call("skill.filesystem", "read", { name }, { signal: ctx.signal })) as {
        content?: string;
      };
      return { name, content: reply?.content ?? "" };
    },

    async refresh(_params, ctx) {
      skills = await rescan(ctx, settings.dirs);
      return { skills };
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const stub = {
      call: async (_capability: string, method: string, params: { name?: string }): Promise<unknown> => {
        if (method === "scan") return { skills: [{ name: "hello", description: "say hi" }] };
        if (method === "read") return { name: params.name, content: "body of hello" };
        throw new Error(`unexpected ${method}`);
      },
      log: (): void => {},
    } as unknown as Channel;
    const wiring: Wiring = { channel: stub, config: { dirs: ["."] }, capabilities: {} };
    await definition.start?.(wiring);

    if (skills.length !== 1) problems.push(`start cached ${skills.length} skills, expected 1`);
    const call = { ...wiring, signal: new AbortController().signal } as unknown as Call;
    const load = definition.methods["load"];
    const loaded = (await load?.({ name: "hello" }, call)) as { content?: string };
    if (loaded?.content !== "body of hello") problems.push(`load returned ${JSON.stringify(loaded)}`);
    try {
      await load?.({ name: "nope" }, call);
      problems.push("load accepted an unknown skill name");
    } catch {
    }
    return problems;
  },
};

runPlugin(definition);
