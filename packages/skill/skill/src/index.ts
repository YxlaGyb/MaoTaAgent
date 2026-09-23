#!/usr/bin/env node
import {
  CallError,
  isPluginEntry,
  runPlugin,
  type Call,
  type Definition,
  type Route,
  type Wiring,
} from "@maota/plugin-kit";
import {
  isSkillName,
  renderCatalog,
  summarize,
  type CatalogEntry,
  type SkillCandidate,
  type SkillDefinition,
  type SkillSummary,
} from "./protocol.ts";
import {
  DEFAULTS,
  discover,
  isActive,
  messageOf,
  pathCandidates,
  positive,
  readCandidate,
  strings,
  type Collection,
  type SkillConflict,
  type Winner,
} from "./discovery.ts";

/// The registry package is also where the dialect lives, so a provider and the
/// model tool depend on one package for the vocabulary instead of two.
export * from "./protocol.ts";
export * from "./scan.ts";
export type { SkillConflict } from "./discovery.ts";

let settings = { ...DEFAULTS };
let providers: Array<[string, Route]> = [];

/// Names this deployment has switched off. It is process state rather than
/// disk state on purpose: a deployment serves one session, so what a person
/// turned off while working ends when that work does.
let disabled = new Set<string>();

/// Rank decides a duplicate first, then the provider's capability name, then
/// the order that provider listed its own rows: three rules that never depend
/// on the order a capability table happened to be built in.
async function collect(ctx: Call, cwd: string, touched: readonly string[]): Promise<Collection> {
  const seen: Array<{ candidate: SkillCandidate; provider: string; index: number }> = [];
  let complete = true;
  let index = 0;
  for (const [capability] of providers) {
    let offered: unknown;
    try {
      const reply = (await ctx.channel.call(capability, "list", { cwd }, { signal: ctx.signal })) as
        | { candidates?: unknown }
        | null;
      offered = reply?.candidates;
    } catch (error) {
      complete = false;
      ctx.channel.log("warn", `${capability} list failed`, { error: messageOf(error) });
      continue;
    }
    if (!Array.isArray(offered)) {
      complete = false;
      ctx.channel.log("warn", `${capability} list returned no candidate array`);
      continue;
    }
    for (const raw of offered) {
      const candidate = readCandidate(raw);
      index += 1;
      if (candidate === null) {
        complete = false;
        ctx.channel.log("warn", `${capability} offered a candidate this build cannot read`);
        continue;
      }
      seen.push({ candidate, provider: capability, index });
    }
  }

  seen.sort(
    (left, right) =>
      left.candidate.rank - right.candidate.rank ||
      (left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0) ||
      left.index - right.index,
  );

  const winners = new Map<string, Winner>();
  const grouped = new Map<string, Array<{ candidate: SkillCandidate; provider: string }>>();
  for (const item of seen) {
    const group = grouped.get(item.candidate.name);
    if (group === undefined) grouped.set(item.candidate.name, [item]);
    else group.push(item);
  }

  const candidates = pathCandidates(touched, cwd);
  const conflicts: SkillConflict[] = [];
  for (const [name, group] of grouped) {
    const first = group[0] as { candidate: SkillCandidate; provider: string };
    const summary = summarize(first.candidate, first.provider, isActive(first.candidate.paths, candidates));
    winners.set(name, { candidate: first.candidate, provider: first.provider, summary });
    if (group.length > 1) {
      conflicts.push({
        name,
        winner: { provider: first.provider, rank: first.candidate.rank, source: first.candidate.source },
        shadowed: group
          .slice(1)
          .map((item) => ({ provider: item.provider, rank: item.candidate.rank, source: item.candidate.source })),
      });
    }
  }
  conflicts.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const skills = [...winners.values()]
    .filter(({ candidate }) => !disabled.has(candidate.name))
    .map(({ summary }) => summary)
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  return { skills, winners, conflicts, complete };
}

function modelCatalog(skills: readonly SkillSummary[]): CatalogEntry[] {
  return skills
    .filter((skill) => skill.active && skill.invocation.modelInvocable)
    .map((skill) => ({ name: skill.name, description: skill.description }));
}

export const definition: Definition = {
  provides: ["skill"],
  configKeys: ["catalog_description_max", "catalog_max_chars"],

  setup(wiring) {
    settings = {
      catalog_description_max: positive(wiring.config.catalog_description_max, DEFAULTS.catalog_description_max),
      catalog_max_chars: positive(wiring.config.catalog_max_chars, DEFAULTS.catalog_max_chars),
    };
  },

  start(wiring) {
    providers = discover(wiring.capabilities);
    wiring.channel.log("info", `skills: providers ${providers.map(([name]) => name).join(", ") || "(none)"}`, {
      providers: providers.length,
    });
  },

  methods: {
    async list(params, ctx) {
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const touched = strings(params?.touched) ?? [];
      const { skills, complete } = await collect(ctx, cwd, touched);
      return { complete, skills };
    },

    async load(params, ctx) {
      const name = String(params?.name ?? "");
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const touched = strings(params?.touched) ?? [];
      // The touched set is read here as well as listed, because a skill whose
      // paths never matched has no business unfolding its body: the catalog
      // hides it, and a name the model remembered from an earlier turn meets
      // the same rule.
      const { winners } = await collect(ctx, cwd, touched);
      const winner = winners.get(name);
      if (winner === undefined) throw new CallError(-32602, `unknown skill: ${name}`);
      if (disabled.has(name)) throw new CallError(-32602, `skill ${name} is disabled in this deployment`);
      if (!winner.summary.active) {
        throw new CallError(-32602, `skill ${name} is conditional and nothing this session touched matches its paths`);
      }
      let content: unknown;
      try {
        const reply = (await ctx.channel.call(
          winner.provider,
          "load",
          { locator: winner.candidate.locator },
          { signal: ctx.signal },
        )) as { content?: unknown } | null;
        content = reply?.content;
      } catch (error) {
        throw new CallError(-32603, `skill ${name} failed to load: ${messageOf(error)}`);
      }
      if (typeof content !== "string") throw new CallError(-32603, `skill ${name} came back without content`);
      const skill: SkillDefinition = { ...winner.summary, content };
      return { skill };
    },

    async catalog(params, ctx) {
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const touched = strings(params?.touched) ?? [];
      const { skills, complete } = await collect(ctx, cwd, touched);
      const entries = modelCatalog(skills);
      return {
        complete,
        entries,
        text: renderCatalog(entries, {
          descriptionMax: settings.catalog_description_max,
          totalMax: settings.catalog_max_chars,
        }),
      };
    },

    /// What this deployment offers but is not showing, and why: a name two
    /// providers both publish, with the one that won and the ones it hid.
    async conflicts(params, ctx) {
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const { conflicts, skills } = await collect(ctx, cwd, []);
      return { conflicts, disabled: [...disabled].sort(), total: skills.length };
    },

    async disable(params, ctx) {
      const name = String(params?.name ?? "");
      if (!isSkillName(name)) throw new CallError(-32602, `not a skill name: ${name}`);
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const { winners } = await collect(ctx, cwd, []);
      if (!winners.has(name)) throw new CallError(-32602, `unknown skill: ${name}`);
      disabled.add(name);
      return { disabled: [...disabled].sort() };
    },

    async enable(params, ctx) {
      const name = String(params?.name ?? "");
      if (!isSkillName(name)) throw new CallError(-32602, `not a skill name: ${name}`);
      const cwd = typeof params?.cwd === "string" ? params.cwd : "";
      const { winners } = await collect(ctx, cwd, []);
      if (!winners.has(name)) {
        throw new CallError(-32602, `unknown skill: ${name}`);
      }
      disabled.delete(name);
      return { disabled: [...disabled].sort() };
    },
  },

  async selfCheck() {
    const problems: string[] = [];
    const catalog = (name: string, over: Record<string, unknown> = {}) => ({
      name,
      description: `about ${name}`,
      source: "custom",
      rank: 300,
      locator: { path: name },
      invocation: { modelInvocable: true, userInvocable: true },
      ...over,
    });

    let asked = 0;
    const channel = {
      call: async (capability: string, method: string): Promise<unknown> => {
        asked += 1;
        if (method === "list") {
          if (capability === "skill.low") {
            return { candidates: [catalog("shared", { rank: 900 }), catalog("low-only")] };
          }
          return {
            candidates: [
              catalog("shared", { rank: 100 }),
              catalog("model-only", { invocation: { modelInvocable: true, userInvocable: false } }),
              catalog("user-only", { invocation: { modelInvocable: false, userInvocable: true } }),
              catalog("conditional", { paths: ["src/ui/**"] }),
              catalog("broken-name", { name: "Not Kebab" }),
              catalog("broken-paths", { paths: "src/**" }),
            ],
          };
        }
        if (method === "load") return { content: "body" };
        throw new Error(`unexpected ${method}`);
      },
      log: (): void => {},
    };
    const ctx = { channel, signal: new AbortController().signal } as unknown as Call;

    const wiring: Wiring = {
      channel: channel as unknown as Call["channel"],
      config: {},
      capabilities: {
        "skill.high": { plugin: "high" },
        "skill.low": { plugin: "low" },
      },
    };
    await definition.setup?.(wiring);
    await definition.start?.(wiring);
    if (providers.length !== 2) problems.push(`discover picked ${providers.length} providers, expected 2`);

    const list = definition.methods["list"];
    const conflictList = definition.methods["conflicts"];
    const disable = definition.methods["disable"];
    const enable = definition.methods["enable"];
    const listed = (await list?.({ cwd: "E:\\proj", touched: [] }, ctx)) as {
      complete?: boolean;
      skills?: SkillSummary[];
    };
    const names = (listed.skills ?? []).map((skill) => skill.name);
    if (names.join(",") !== [...names].sort().join(",")) problems.push("list did not sort by name");
    if (!names.includes("low-only")) problems.push(`list lost a provider: ${names}`);
    const shared = listed.skills?.find((skill) => skill.name === "shared");
    if (shared?.provider !== "skill.high") problems.push(`the lower rank lost: ${JSON.stringify(shared?.provider)}`);
    if ((shared as unknown as { rank?: unknown })?.rank !== undefined) problems.push("a summary leaked its rank");
    if (names.includes("broken-name")) problems.push("a non-kebab name was kept");
    if (names.includes("broken-paths")) problems.push("a malformed paths list was kept");
    if (listed.complete !== false) problems.push("an unreadable candidate did not make the read incomplete");

    const conditional = listed.skills?.find((skill) => skill.name === "conditional");
    if (conditional?.active !== false) problems.push("a conditional skill was active with nothing touched");
    const inside = (await list?.({ cwd: "E:\\proj", touched: ["E:\\proj\\src\\ui\\Button.tsx"] }, ctx)) as {
      skills?: SkillSummary[];
    };
    if (inside.skills?.find((skill) => skill.name === "conditional")?.active !== true) {
      problems.push("a conditional skill stayed inactive after a match");
    }
    const outside = (await list?.({ cwd: "E:\\proj", touched: ["E:\\proj\\db\\schema.sql"] }, ctx)) as {
      skills?: SkillSummary[];
    };
    if (outside.skills?.find((skill) => skill.name === "conditional")?.active !== false) {
      problems.push("a conditional skill activated on an unrelated path");
    }
    const absolute = (await list?.({ cwd: "E:\\proj", touched: ["E:\\proj\\src\\ui\\Button.tsx"] }, ctx)) as {
      skills?: SkillSummary[];
    };
    if (absolute.skills?.find((skill) => skill.name === "conditional")?.active !== true) {
      problems.push("an absolute pattern did not match a touched path");
    }

    const built = (await definition.methods["catalog"]?.({ cwd: "E:\\proj", touched: [] }, ctx)) as {
      entries?: CatalogEntry[];
      text?: string;
    };
    const advertised = (built.entries ?? []).map((entry) => entry.name);
    if (advertised.includes("user-only")) problems.push("the model catalog advertised a user-only skill");
    if (advertised.includes("conditional")) problems.push("the model catalog advertised an inactive skill");
    if (!advertised.includes("model-only")) problems.push("the model catalog dropped a model-only skill");
    if (built.text?.includes("<available_skills>") !== true) problems.push(`catalog text is ${built.text}`);
    if (built.text?.includes("Call the skill tool") !== true) problems.push("catalog text lost its call guidance");

    const load = definition.methods["load"];
    const loaded = (await load?.({ name: "shared", cwd: "E:\\proj" }, ctx)) as { skill?: SkillDefinition };
    if (loaded.skill?.content !== "body") problems.push(`load returned ${JSON.stringify(loaded.skill?.content)}`);
    if (loaded.skill?.provider !== "skill.high") problems.push("load lost the winning provider");
    try {
      await load?.({ name: "conditional", cwd: "E:\\proj" }, ctx);
      problems.push("load unfolded a conditional skill nothing had matched");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("load refused a conditional skill with the wrong code");
    }
    const duringMatch = (await load?.({ name: "conditional", cwd: "E:\\proj", touched: ["E:\\proj\\src\\ui\\x.ts"] }, ctx)) as {
      skill?: SkillDefinition;
    };
    if (duringMatch.skill?.name !== "conditional") problems.push("load refused a conditional skill that did match");
    try {
      await load?.({ name: "nope", cwd: "E:\\proj" }, ctx);
      problems.push("load accepted an unknown name");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("load refused an unknown name with the wrong code");
    }

    /// Two providers publishing one name is not an error, but it is worth
    /// saying which one won and which one it hid.
    const clashes = (await conflictList?.({ cwd: "E:\\proj" }, ctx)) as {
      conflicts?: Array<{ name?: string; winner?: { provider?: string }; shadowed?: Array<{ provider?: string }> }>;
    };
    const shared2 = clashes.conflicts?.find((entry) => entry.name === "shared");
    if (shared2?.winner?.provider !== "skill.high") problems.push("conflicts lost the winner");
    if (shared2?.shadowed?.[0]?.provider !== "skill.low") problems.push("conflicts lost the loser");
    if (clashes.conflicts?.some((entry) => entry.name !== "shared")) {
      problems.push("conflicts invented a clash between names that are not shared");
    }

    /// Switching one off is felt everywhere the name would appear, and switching
    /// it back on restores it without forgetting anything else.
    await disable?.({ name: "shared", cwd: "E:\\proj" }, ctx);
    const hidden = (await list?.({ cwd: "E:\\proj" }, ctx)) as { skills?: SkillSummary[] };
    if (hidden.skills?.some((skill) => skill.name === "shared")) problems.push("a disabled skill still listed");
    try {
      await load?.({ name: "shared", cwd: "E:\\proj" }, ctx);
      problems.push("a disabled skill still loaded");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("a disabled skill was refused with the wrong code");
    }
    await enable?.({ name: "shared", cwd: "E:\\proj" }, ctx);
    const back = (await list?.({ cwd: "E:\\proj" }, ctx)) as { skills?: SkillSummary[] };
    if (!back.skills?.some((skill) => skill.name === "shared")) problems.push("an enabled skill stayed hidden");
    try {
      await disable?.({ name: "no-such", cwd: "E:\\proj" }, ctx);
      problems.push("disabling an unknown name was accepted");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("an unknown name was refused with the wrong code");
    }

    let failed = 0;
    const broken = {
      channel: {
        call: async (): Promise<unknown> => {
          failed += 1;
          throw new Error("provider down");
        },
        log: (): void => {},
      },
      signal: new AbortController().signal,
    } as unknown as Call;
    const before = asked;
    const partial = (await list?.({ cwd: "" }, broken)) as { complete?: boolean };
    if (failed !== 2) problems.push(`a failing provider was asked ${failed} times, expected 2`);
    if (partial.complete !== false) problems.push("a failing provider did not make the read incomplete");
    if (asked !== before) problems.push("a failing read reached a provider it was never asked about");

    providers = [];
    const none = (await list?.({}, ctx)) as { complete?: boolean; skills?: SkillSummary[] };
    if (none.complete !== true || (none.skills ?? []).length !== 0) problems.push("an empty registry was not empty");
    return problems;
  },
};

/// This package is spawned as the registry and imported by the providers for
/// the dialect, so it serves only when the process was started with it.
if (isPluginEntry(import.meta.url)) runPlugin(definition);
