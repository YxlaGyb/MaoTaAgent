import { CallError } from "@maota/plugin-kit";

import { interpolate, joinBlocks, type Values } from "./render.ts";

/// Two layers are enough for a deployment: what the harness always says, and
/// what one conversation adds to it. A name in the session layer replaces the
/// global one rather than joining it, so a deployment never has to know how many
/// other plugins wrote something on the subject.
export const GLOBAL_SCOPE = "global";

/// Where the harness seats its own sections. The numbers are the contract
/// between plugins that never see each other, so the gap between them is wide
/// enough for a deployment to slip a section in without renumbering anything.
export const SECTION_ORDERS = {
  HARNESS: -1000,
  PERSONA: 0,
  ENVIRONMENT: 500,
  WORKING_DIRECTORY: 900,
  APPROVAL: 1000,
} as const;

export interface PromptFacts {
  session_id: string;
  cwd: string | null;
  approval: string | null;
  persona: string | null;
}

export type SectionText = string | ((facts: PromptFacts) => string);
export type VariableValue = string | ((facts: PromptFacts) => string);

export interface SectionInput {
  name: string;
  order: number;
  text: SectionText;
  scope?: string;
  /// A section that restates what the model wrote elsewhere opts out, so a
  /// brace in configuration text stays a brace.
  interpolate?: boolean;
}

export interface VariableInput {
  name: string;
  value: VariableValue;
  scope?: string;
}

export interface SectionRecord {
  name: string;
  order: number;
  scope: string;
  text: SectionText;
  interpolate: boolean;
}

export interface SectionSummary {
  name: string;
  order: number;
  scope: string;
  chars: number;
}

export interface Assembly {
  text: string;
  sections: SectionSummary[];
  variables: string[];
}

/// Registration order never decides what the model reads: a section is placed by
/// its order and then by its name, so two plugins that both register at 1000
/// still assemble the same prompt in every process.
export function compareSections(left: { order: number; name: string }, right: { order: number; name: string }): number {
  if (left.order !== right.order) return left.order - right.order;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function layer<T>(layers: Map<string, Map<string, T>>, scope: string): Map<string, T> {
  const found = layers.get(scope);
  if (found !== undefined) return found;
  const created = new Map<string, T>();
  layers.set(scope, created);
  return created;
}

export function readName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CallError(-32602, `a prompt name must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readScope(value: unknown): string {
  if (value === undefined || value === null || value === "") return GLOBAL_SCOPE;
  return readName(value);
}

export function readOrder(value: unknown): number {
  if (value === undefined || value === null) return SECTION_ORDERS.PERSONA;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CallError(-32602, `order must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readFacts(value: unknown): PromptFacts {
  const input = value === null || typeof value !== "object" ? {} : (value as Record<string, unknown>);
  return {
    session_id: optionalText(input.session_id, "session_id") ?? "",
    cwd: optionalText(input.cwd, "cwd"),
    approval: optionalText(input.approval, "approval"),
    persona: optionalText(input.persona, "persona"),
  };
}

function optionalText(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CallError(-32602, `${name} must be a string, got ${JSON.stringify(value)}`);
  return value;
}

export class Registry {
  private readonly sections = new Map<string, Map<string, SectionRecord>>();
  private readonly variables = new Map<string, Map<string, VariableInput>>();

  addSection(input: SectionInput): SectionRecord {
    const name = readName(input.name);
    const scope = readScope(input.scope);
    const found = layer(this.sections, scope);
    if (found.has(name)) {
      throw new CallError(-32602, `the prompt section ${name} is already registered in scope ${scope}`);
    }
    const record: SectionRecord = {
      name,
      order: readOrder(input.order),
      scope,
      text: input.text,
      interpolate: input.interpolate !== false,
    };
    found.set(name, record);
    return record;
  }

  removeSection(name: unknown, scope: string): boolean {
    const found = this.sections.get(scope);
    if (found === undefined) return false;
    const removed = found.delete(readName(name));
    if (found.size === 0) this.sections.delete(scope);
    return removed;
  }

  addVariable(input: VariableInput): { name: string; scope: string } {
    const name = readName(input.name);
    const scope = readScope(input.scope);
    const found = layer(this.variables, scope);
    if (found.has(name)) {
      throw new CallError(-32602, `the prompt variable ${name} is already registered in scope ${scope}`);
    }
    found.set(name, { name, value: input.value, scope });
    return { name, scope };
  }

  removeVariable(name: unknown, scope: string): boolean {
    const found = this.variables.get(scope);
    if (found === undefined) return false;
    const removed = found.delete(readName(name));
    if (found.size === 0) this.variables.delete(scope);
    return removed;
  }

  /// A conversation that ends gives its layer back, and the global one is not
  /// on offer: a plugin that took the harness's own voice away could not put it
  /// back, and every later turn would read a prompt nobody wrote.
  release(scope: unknown): { scope: string; sections: number; variables: number } {
    const name = readScope(scope);
    if (name === GLOBAL_SCOPE) throw new CallError(-32602, "the global scope cannot be released");
    const sections = this.sections.get(name)?.size ?? 0;
    const variables = this.variables.get(name)?.size ?? 0;
    this.sections.delete(name);
    this.variables.delete(name);
    return { scope: name, sections, variables };
  }

  assemble(facts: PromptFacts): Assembly {
    const scope = facts.session_id === "" ? GLOBAL_SCOPE : facts.session_id;
    const chosen = [...merge(this.sections, scope).values()].sort(compareSections);
    const values = this.values(facts, scope);
    const blocks: string[] = [];
    const sections: SectionSummary[] = [];
    for (const record of chosen) {
      const raw = typeof record.text === "function" ? record.text(facts) : record.text;
      const text = record.interpolate ? interpolate(raw, values.get) : raw;
      const trimmed = text.trim();
      if (trimmed === "") continue;
      blocks.push(trimmed);
      sections.push({ name: record.name, order: record.order, scope: record.scope, chars: trimmed.length });
    }
    return { text: joinBlocks(blocks), sections, variables: values.names };
  }

  private values(facts: PromptFacts, scope: string): { get: Values; names: string[] } {
    const resolved = new Map<string, string>();
    for (const [name, record] of merge(this.variables, scope)) {
      resolved.set(name, typeof record.value === "function" ? record.value(facts) : record.value);
    }
    return {
      get: (name) => resolved.get(name),
      names: [...resolved.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    };
  }
}

function merge<T>(layers: Map<string, Map<string, T>>, scope: string): Map<string, T> {
  const merged = new Map<string, T>(layers.get(GLOBAL_SCOPE) ?? []);
  if (scope === GLOBAL_SCOPE) return merged;
  for (const [name, record] of layers.get(scope) ?? []) merged.set(name, record);
  return merged;
}
