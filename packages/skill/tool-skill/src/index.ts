#!/usr/bin/env node
import { CallError, defineTools, packageVersion, runPlugin, type Call, type Definition } from "@maota/plugin-kit";
import {
  isSkillName,
  readControl,
  renderSkillContent,
  type SkillControl,
  type SkillDefinition,
  type SkillSummary,
} from "@maota/skill";

/// A skill crosses a process boundary to get here, so what comes back is read
/// rather than trusted: a name that is not a name, or a policy that is not a
/// boolean, is a provider this build cannot talk to.
function readSummary(raw: unknown): SkillSummary | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const name = input.name;
  const description = input.description;
  const policy = input.invocation as { modelInvocable?: unknown; userInvocable?: unknown } | undefined;
  if (typeof name !== "string" || !isSkillName(name)) return null;
  if (typeof description !== "string") return null;
  if (policy === null || typeof policy !== "object") return null;
  const { modelInvocable, userInvocable } = policy;
  if (typeof modelInvocable !== "boolean" || typeof userInvocable !== "boolean") return null;
  const source = input.source;
  if (typeof source !== "string" || source === "") return null;
  const base = input.resourceBase as { kind?: unknown; path?: unknown } | undefined;
  let resourceBase: { kind: "directory"; path: string } | undefined;
  if (base !== undefined) {
    if (base === null || typeof base !== "object" || base.kind !== "directory") return null;
    if (typeof base.path !== "string" || base.path === "") return null;
    resourceBase = { kind: "directory", path: base.path };
  }
  const shared = readControl({
    ...(input.allowedTools === undefined ? {} : { tools_allow: input.allowedTools }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
    ...(input.context === undefined ? {} : { context: input.context }),
  });
  if (shared === null) return null;
  return {
    name,
    description,
    source,
    invocation: { modelInvocable, userInvocable },
    active: input.active !== false,
    provider: typeof input.provider === "string" ? input.provider : "",
    ...(resourceBase === undefined ? {} : { resourceBase }),
    ...(shared.tools_allow === undefined ? {} : { allowedTools: shared.tools_allow }),
    ...(shared.model === undefined ? {} : { model: shared.model }),
    ...(shared.hooks === undefined ? {} : { hooks: shared.hooks }),
    ...(shared.context === undefined ? {} : { context: shared.context }),
  };
}

/// The run-scoped half of a loaded skill, read back off the summary: a tool may
/// only hand the loop what the skill actually declared.
function controlOf(skill: SkillSummary): SkillControl | null {
  return readControl({
    ...(skill.allowedTools === undefined ? {} : { tools_allow: skill.allowedTools }),
    ...(skill.model === undefined ? {} : { model: skill.model }),
    ...(skill.hooks === undefined ? {} : { hooks: skill.hooks }),
    ...(skill.context === undefined ? {} : { context: skill.context }),
  });
}

function readNames(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !isSkillName(item.trim())) {
      throw new CallError(-32602, `skill names are kebab-case, got ${JSON.stringify(item ?? null)}`);
    }
    if (!names.includes(item.trim())) names.push(item.trim());
  }
  return names;
}

function readDefinition(reply: unknown): SkillDefinition | null {
  const skill = (reply as { skill?: unknown } | null | undefined)?.skill;
  const summary = readSummary(skill);
  const content = (skill as { content?: unknown } | undefined)?.content;
  if (summary === null || typeof content !== "string") return null;
  return { ...summary, content };
}

function closed(name: string): CallError {
  return new CallError(
    -32602,
    `skill ${JSON.stringify(name)} is not open to the model; ask the user to invoke it instead`,
  );
}

const VERSION = packageVersion(import.meta.url);

const toolkit = defineTools([
  {
    capability: "tool.skill",
    version: VERSION,
    description:
      "Load one or more skills by their exact names, in the order given: it returns their instructions " +
      "and the directory their references, scripts and assets live in.",
    parameters: {
      name: {
        type: "string",
        required: true,
        description: "The skill name, exactly as the available_skills list spells it.",
      },
      names: {
        type: "array",
        items: { type: "string" },
        description: "Further skill names to load in the same call, after name.",
      },
      args: {
        type: "object",
        additionalProperties: true,
        description:
          "Values the skill body asks for: $ARGUMENTS becomes the whole object, ${key} becomes one value.",
      },
      touched: {
        type: "array",
        items: { type: "string" },
        host: "session_touched",
        description: "The paths this session has touched, so a conditional skill can be checked.",
      },
      cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    },
    concurrency: "always",
    maxResultChars: null,
    run: async (args, call: Call) => {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!isSkillName(name)) {
        throw new CallError(-32602, `skill names are kebab-case, got ${JSON.stringify(args.name ?? null)}`);
      }
      const names = [name, ...readNames(args.names).filter((other) => other !== name)];
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      const touched = Array.isArray(args.touched) ? args.touched.filter((item) => typeof item === "string") : [];
      const listed = (await call.channel.call("skill", "list", { cwd, touched }, { signal: call.signal })) as
        | { skills?: unknown }
        | null;
      const offered = Array.isArray(listed?.skills) ? listed.skills : [];
      const summaries = offered.map(readSummary).filter((item): item is SkillSummary => item !== null);

      const blocks: string[] = [];
      const control: SkillControl = {};
      for (const wanted of names) {
        const summary = summaries.find((item) => item.name === wanted);
        if (summary === undefined) throw new CallError(-32602, `no skill named ${JSON.stringify(wanted)}`);
        // Both checks run before the body is read: a skill the model may not
        // invoke never costs a read, and a conditional skill whose paths nothing
        // matches is refused here rather than unfolding instructions that do
        // not apply.
        if (!summary.invocation.modelInvocable) throw closed(wanted);
        if (!summary.active) {
          throw new CallError(-32602, `skill ${wanted} is conditional and nothing this session touched matches it`);
        }

        const reply = await call.channel.call(
          "skill",
          "load",
          { name: wanted, cwd, touched },
          { signal: call.signal },
        );
        const definition = readDefinition(reply);
        if (definition === null) throw new CallError(-32603, `skill ${wanted} came back without readable content`);
        if (!definition.invocation.modelInvocable) throw closed(wanted);
        const runControl = controlOf(definition);
        if (runControl === null) {
          throw new CallError(-32603, `skill ${wanted} came back with a control this build cannot read`);
        }
        blocks.push(renderSkillContent(definition, args.args));
        if (runControl.tools_allow !== undefined) {
          const keep = runControl.tools_allow;
          control.tools_allow = control.tools_allow === undefined ? keep : control.tools_allow.filter((n) => keep.includes(n));
        }
        if (runControl.model !== undefined) control.model = runControl.model;
        if (runControl.hooks !== undefined) control.hooks = [...(control.hooks ?? []), ...runControl.hooks];
        if (runControl.context === "fork") control.context = "fork";
      }
      return { content: blocks.join("\n\n"), ...(Object.keys(control).length === 0 ? {} : { control }) };
    },
  },
]);

export const definition: Definition = {
  provides: toolkit.provides,
  configKeys: [],
  methods: { ...toolkit.methods },

  async selfCheck() {
    const problems: string[] = [];
    const spec = toolkit.methods.describe({}, { capability: "tool.skill" } as unknown as Call) as {
      name?: string;
      input_schema?: { required?: string[]; properties?: Record<string, unknown> };
      host_args?: Array<{ name: string; source: string }>;
    };
    if (spec.name !== "skill") problems.push(`the tool is named ${String(spec.name)}`);
    if (spec.input_schema?.required?.join(",") !== "name") problems.push("name is not the only required argument");
    if (Object.hasOwn(spec.input_schema?.properties ?? {}, "cwd")) problems.push("the spec exposes the host cwd");
    if (Object.hasOwn(spec.input_schema?.properties ?? {}, "touched")) problems.push("the spec exposes the host paths");
    if (Object.hasOwn(spec.input_schema?.properties ?? {}, "names") !== true) problems.push("the spec has no names");
    const sources = (spec.host_args ?? []).map((arg) => arg.source).sort().join(",");
    if (sources !== "session_cwd,session_touched") problems.push(`the spec asks for ${sources}`);
    const policy = toolkit.methods.policy({}, { capability: "tool.skill" } as unknown as Call) as {
      concurrency?: string;
      max_result_chars?: number | null;
    };
    if (policy.concurrency !== "always") problems.push(`the tool runs as ${String(policy.concurrency)}`);
    if (policy.max_result_chars !== null) problems.push("the tool would spill its instructions");

    let loads = 0;
    const summary = (name: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
      name,
      description: `about ${name}`,
      source: "user",
      provider: "skill.filesystem",
      active: true,
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: "directory", path: `C:\\skills\\${name}` },
      ...over,
    });
    /// A provider answers `list` and `load` about the same skill, so the two
    /// replies carry the same fields; a fake that forgot one would hide exactly
    /// the bug this check is looking for.
    const extras: Record<string, Record<string, unknown>> = {
      demo: {
        allowedTools: ["read", "grep"],
        model: "small",
        context: "fork",
        hooks: [{ event: "PreToolUse", command: "guard.ps1", matcher: "pwsh" }],
      },
      other: { allowedTools: ["read", "write"] },
      private: { invocation: { modelInvocable: false, userInvocable: true } },
      conditional: { active: false, paths: ["packages/**"] },
    };
    const channel = {
      call: async (_capability: string, method: string, params: Record<string, unknown>): Promise<unknown> => {
        if (method === "list") {
          return {
            complete: true,
            skills: Object.keys(extras).map((name) => summary(name, extras[name])),
          };
        }
        loads += 1;
        return {
          skill: {
            ...summary(String(params.name ?? ""), extras[String(params.name ?? "")] ?? {}),
            content: "Hello $ARGUMENTS for ${topic}.",
          },
        };
      },
      log: (): void => {},
    };
    const ctx = { channel, signal: new AbortController().signal, capability: "tool.skill" } as unknown as Call;
    const run = toolkit.methods.run;

    const loaded = (await run({ name: "demo", cwd: "C:\\proj", touched: [] }, ctx)) as {
      content?: string;
      control?: Record<string, unknown>;
    };
    const text = String(loaded.content ?? "");
    if (text.includes('<skill_content name="demo">') !== true) problems.push(`the result was ${text}`);
    if (text.includes("C:\\skills\\demo") !== true) problems.push("the result did not name the skill directory");
    if (text.includes("not data") !== true) problems.push("the result did not mark the block as instruction");
    const control = loaded.control ?? {};
    if ((control.tools_allow as string[] | undefined)?.join(",") !== "read,grep") {
      problems.push(`the control carried ${JSON.stringify(control.tools_allow)}`);
    }
    if (control.model !== "small") problems.push(`the control carried model ${String(control.model)}`);
    if (control.context !== "fork") problems.push(`the control carried context ${String(control.context)}`);
    if ((control.hooks as unknown[] | undefined)?.length !== 1) problems.push("the control dropped the skill hooks");

    /// One call may bring in more than one body, and the narrowing is the
    /// intersection: the narrower skill wins where they disagree.
    const both = (await run({ name: "demo", names: ["other"], cwd: "C:\\proj", touched: [] }, ctx)) as {
      content?: string;
      control?: Record<string, unknown>;
    };
    if (String(both.content ?? "").split("<skill_content").length !== 3) problems.push("names did not load two bodies");
    if ((both.control?.tools_allow as string[] | undefined)?.join(",") !== "read") {
      problems.push(`two skills narrowed to ${JSON.stringify(both.control?.tools_allow)}`);
    }

    /// `$ARGUMENTS` and `${key}` are the two ways a body asks for what the call
    /// brought, and a name the call did not bring stays as it was written.
    const withArgs = (await run({ name: "demo", args: { topic: "caching" }, cwd: "C:\\proj", touched: [] }, ctx)) as {
      content?: string;
    };
    if (String(withArgs.content ?? "").includes('{"topic":"caching"}') !== true) {
      problems.push("$ARGUMENTS was not substituted");
    }
    if (String(withArgs.content ?? "").includes("for caching.") !== true) problems.push("${topic} was not substituted");

    for (const bad of ["Demo", "with space", ""]) {
      try {
        await run({ name: bad, cwd: "C:\\proj" }, ctx);
        problems.push(`run accepted the name ${JSON.stringify(bad)}`);
      } catch (error) {
        if ((error as CallError).code !== -32602) problems.push(`run refused ${JSON.stringify(bad)} with the wrong code`);
      }
    }
    try {
      await run({ name: "missing", cwd: "C:\\proj" }, ctx);
      problems.push("run accepted an unknown name");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("run refused an unknown name with the wrong code");
    }
    const before = loads;
    try {
      await run({ name: "private", cwd: "C:\\proj" }, ctx);
      problems.push("run loaded a skill the model may not invoke");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("run refused a closed skill with the wrong code");
    }
    /// A conditional skill whose paths nothing touched is refused here, before
    /// its body is read, exactly like one the model may not invoke.
    try {
      await run({ name: "conditional", cwd: "C:\\proj", touched: ["src/index.ts"] }, ctx);
      problems.push("run loaded a conditional skill that does not apply");
    } catch (error) {
      if ((error as CallError).code !== -32602) problems.push("run refused a conditional skill with the wrong code");
    }
    if (loads !== before) problems.push("run read a body before checking the policy");
    return problems;
  },
};

runPlugin(definition);
