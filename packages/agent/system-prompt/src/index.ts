#!/usr/bin/env node
import { CallError, isPluginEntry, runPlugin, type Definition } from "@maota/plugin-kit";

import { interpolate, joinBlocks } from "./render.ts";
import {
  GLOBAL_SCOPE,
  Registry,
  SECTION_ORDERS,
  compareSections,
  readFacts,
  readName,
  readOrder,
  readScope,
  type Assembly,
} from "./registry.ts";
import { DEFAULTS, HARNESS, approvalText, builtins } from "./sections.ts";

export function readPersona(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : DEFAULTS.persona;
}

let persona = DEFAULTS.persona;
const registry = new Registry();

/// A plugin may be started again over the same process, so the harness's own
/// sections are seated by name: the second start replaces what the first one
/// wrote instead of tripping over it.
function seat(): void {
  const built = builtins(persona);
  for (const section of built.sections) {
    registry.removeSection(section.name, GLOBAL_SCOPE);
    registry.addSection(section);
  }
  for (const variable of built.variables) {
    registry.removeVariable(variable.name, GLOBAL_SCOPE);
    registry.addVariable(variable);
  }
}

function readSectionText(value: unknown): string {
  if (typeof value !== "string") {
    throw new CallError(-32602, `section text must be a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function readFlag(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new CallError(-32602, `${name} must be a boolean`);
  return value;
}

const methods = {
  assemble(params: any): Assembly {
    return registry.assemble(readFacts(params));
  },

  register(params: any) {
    const record = registry.addSection({
      name: readName(params?.name),
      order: readOrder(params?.order),
      text: readSectionText(params?.text),
      scope: params?.scope,
      interpolate: readFlag(params?.interpolate, "interpolate"),
    });
    return { name: record.name, order: record.order, scope: record.scope };
  },

  unregister(params: any) {
    return { removed: registry.removeSection(params?.name, readScope(params?.scope)) };
  },

  release(params: any) {
    return registry.release(params?.scope);
  },
};

export const definition: Definition = {
  provides: ["system-prompt"],
  configKeys: ["persona"],

  setup(wiring) {
    persona = readPersona(wiring.config.persona);
  },

  start(wiring) {
    seat();
    const names = builtins(persona).sections.map((section) => section.name);
    wiring.channel.log("info", `system-prompt: sections ${names.join(", ")}`, { count: names.length });
  },

  methods,

  async selfCheck() {
    const problems: string[] = [];
    if (interpolate("a {{x}} b", () => "1") !== "a 1 b") problems.push("a known variable was not replaced");
    if (interpolate("{{ x }}", () => "1") !== "1") problems.push("a padded variable name was not trimmed");
    if (interpolate("a {{x b", () => "1") !== "a {{x b") problems.push("an unclosed brace was not left alone");
    if (interpolate("{{}}", () => "1") !== "{{}}") problems.push("an empty variable was not left alone");
    try {
      interpolate("{{nope}}", () => undefined);
      problems.push("an unknown variable was replaced with something");
    } catch (error) {
      if (!(error instanceof CallError)) problems.push(`an unknown variable threw ${String(error)}`);
    }

    if (joinBlocks(["  a  ", "", "   ", "b"]) !== "a\n\nb") problems.push("empty blocks were not dropped");
    if (joinBlocks([]) !== "") problems.push("an empty assembly was not empty");

    if (compareSections({ order: 5, name: "b" }, { order: 5, name: "a" }) <= 0) {
      problems.push("two sections at the same order were not sorted by name");
    }
    if (compareSections({ order: 9, name: "a" }, { order: 5, name: "z" }) <= 0) {
      problems.push("a later order did not sort after an earlier one");
    }

    if (readScope(undefined) !== GLOBAL_SCOPE) problems.push("a missing scope did not default to global");
    if (readOrder(undefined) !== 0) problems.push("a missing order did not default to 0");
    if (readFacts(undefined).session_id !== "") problems.push("missing facts invented a session");
    if (readPersona("  ") !== DEFAULTS.persona) problems.push("a blank persona did not fall back");
    if (readPersona("hello") !== "hello") problems.push("a configured persona was not read");
    for (const [value, what] of [
      [() => readName(" "), "a blank prompt name"],
      [() => readOrder(1.5), "a fractional order"],
      [() => readFacts({ cwd: 7 }), "a non-string cwd"],
    ] as const) {
      try {
        value();
        problems.push(`${what} was accepted`);
      } catch {
      }
    }

    const table = new Registry();
    table.addSection({ name: "one", order: 10, text: "one" });
    try {
      table.addSection({ name: "one", order: 20, text: "dup" });
      problems.push("a section registered twice in one scope was kept");
    } catch {
    }
    table.addVariable({ name: "city", value: "Paris" });
    table.addSection({ name: "where", order: 20, text: "in {{city}}" });
    if (!table.assemble(readFacts({})).text.includes("in Paris")) {
      problems.push("a registered variable was not resolved");
    }
    table.addSection({ name: "bad", order: 30, text: "{{missing}}" });
    try {
      table.assemble(readFacts({}));
      problems.push("an unknown variable did not stop the assembly");
    } catch {
    }
    if (!table.removeSection("bad", GLOBAL_SCOPE)) problems.push("a registered section could not be removed");
    if (!table.removeSection("where", GLOBAL_SCOPE)) problems.push("a section was not removed by name");
    if (!table.removeVariable("city", GLOBAL_SCOPE)) problems.push("a registered variable could not be removed");

    table.addSection({ name: "one", order: 10, text: "session one", scope: "s1" });
    if (!table.assemble(readFacts({ session_id: "s1" })).text.includes("session one")) {
      problems.push("a session section did not shadow the global one");
    }
    if (table.assemble(readFacts({ session_id: "s2" })).text.includes("session one")) {
      problems.push("a session section leaked into another session");
    }
    if (table.release("s1").sections !== 1) problems.push("a released scope reported the wrong count");
    if (table.assemble(readFacts({ session_id: "s1" })).text.includes("session one")) {
      problems.push("a released scope kept its section");
    }
    try {
      table.release(GLOBAL_SCOPE);
      problems.push("the global scope was released");
    } catch {
    }

    const built = new Registry();
    const seated = builtins(readPersona(undefined));
    for (const section of seated.sections) built.addSection(section);
    for (const variable of seated.variables) built.addVariable(variable);
    const bare = built.assemble(readFacts({ session_id: "s1" }));
    if (!bare.text.includes(HARNESS)) problems.push("the harness identity is missing");
    if (!bare.text.includes(DEFAULTS.persona)) problems.push("the default persona is missing");
    if (bare.text.includes("working directory:")) problems.push("a prompt with no working directory invented one");
    if (bare.text.includes("approval:")) problems.push("a prompt with no policy stated one");

    const full = built.assemble(readFacts({ session_id: "s1", cwd: "E:\\proj", approval: "ask" }));
    if (!full.text.includes("working directory: E:\\proj")) problems.push("the working directory was not stated");
    if (!full.text.includes(approvalText("ask"))) problems.push("the approval policy was not stated");
    if (full.sections.map((section) => section.name).join(",") !== "harness,persona,working-directory,approval") {
      problems.push(`the built-in sections assembled out of order: ${full.sections.map((s) => s.name).join(",")}`);
    }
    if (full.text.includes("{{")) problems.push("an assembled prompt kept a variable");
    if (full.variables.join(",") !== "cwd,session_id") problems.push(`the variables were ${full.variables.join(",")}`);

    const override = built.assemble(readFacts({ session_id: "s1", persona: "SUB" }));
    if (!override.text.includes("SUB") || override.text.includes(DEFAULTS.persona)) {
      problems.push("a per-run persona did not replace the configured one");
    }
    const literal = built.assemble(readFacts({ session_id: "s1", persona: "keep {{this}}" }));
    if (!literal.text.includes("keep {{this}}")) problems.push("a persona was interpolated");
    if (literal.text.includes("{{cwd}}")) problems.push("a persona swallowed the working directory");

    if (!approvalText("auto").includes("without asking")) problems.push("the auto policy reads wrong");
    if (!approvalText("full").includes("without asking")) problems.push("the full policy reads wrong");
    if (approvalText(null) !== "") problems.push("a missing policy produced text");
    if (approvalText("nonsense") !== "") problems.push("an unknown policy produced text");

    seat();
    const before = (await methods.assemble({ session_id: "s" })) as Assembly;
    await methods.register({ name: "extra", order: 2000, text: "extra: {{session_id}}" });
    const viaMethod = (await methods.assemble({ session_id: "s" })) as Assembly;
    if (!viaMethod.text.endsWith("extra: s")) problems.push(`a registered section assembled as ${JSON.stringify(viaMethod.text)}`);
    if (viaMethod.sections.at(-1)?.name !== "extra") problems.push("a registered section did not sort last");
    const removed = (await methods.unregister({ name: "extra" })) as { removed?: boolean };
    if (removed.removed !== true) problems.push("a section registered over the wire could not be removed");
    const after = (await methods.assemble({ session_id: "s" })) as Assembly;
    if (after.text !== before.text) problems.push("an unregistered section stayed in the assembly");
    for (const [params, what] of [
      [{ name: "x", order: 1, text: 7 }, "a non-string section text"],
      [{ name: "x", order: 1, text: "t", interpolate: "yes" }, "a non-boolean interpolate"],
    ] as const) {
      try {
        await methods.register({ ...params });
        problems.push(`${what} reached the registry`);
      } catch {
      }
    }
    try {
      await methods.release({ scope: GLOBAL_SCOPE });
      problems.push("the global scope was released over the wire");
    } catch {
    }
    if (SECTION_ORDERS.HARNESS >= SECTION_ORDERS.PERSONA) problems.push("the harness section sorts after the persona");

    return problems;
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);

