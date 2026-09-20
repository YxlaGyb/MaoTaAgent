import { CallError } from "./channel.ts";
import {
  assertSupportedJsonSchema,
  JsonSchemaError,
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type JsonSchemaScalar,
  type JsonSchemaType,
} from "./json-schema.ts";
import type { Call, Method, Provide } from "./plugin.ts";

export type ParameterType = JsonSchemaType;

export type HostSource = "session_cwd";

export interface ParameterField {
  type: ParameterType;
  required?: boolean;
  description?: string;
  enum?: JsonSchemaScalar[];
  items?: ParameterField;
  additionalProperties?: boolean;
  host?: HostSource;
}

export interface HostArg {
  name: string;
  source: HostSource;
}

export type Concurrency = "always" | "never" | { safe(args: Record<string, unknown>): boolean };

export interface ToolBlueprint {
  capability: string;
  version: string;
  description: string;
  parameters: Record<string, ParameterField>;
  concurrency: Concurrency;
  maxResultChars?: number | null;
  run(args: Record<string, unknown>, call: Call): Promise<unknown> | unknown;
}

export interface ToolPolicy {
  concurrency: "always" | "never" | "args";
  max_result_chars?: number | null;
}

export interface ToolDescription {
  name: string;
  description: string;
  input_schema: JsonSchemaNode;
  host_args: HostArg[];
}

export type ToolMethodName = "describe" | "policy" | "run" | "classify";

export interface ToolKit {
  provides: Provide[];
  methods: Record<ToolMethodName, Method>;
}

const CAPABILITY = /^tool\.[a-z][a-z0-9_]*$/;

const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const HOST_SOURCES = new Set<string>(["session_cwd"]);

export class ToolArgsError extends CallError {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(-32602, `invalid arguments: ${violations.join("; ")}`, { code: "INVALID_ARGS", violations });
    this.name = "ToolArgsError";
    this.violations = violations;
  }
}

export function validateParameters(schema: JsonSchemaNode, args: unknown): string[] {
  return validateJsonSchemaValue(schema, args === undefined || args === null ? {} : args, "arguments");
}

function argsOf(params: unknown): Record<string, unknown> {
  return params === undefined || params === null ? {} : (params as Record<string, unknown>);
}

function compileField(field: ParameterField, path: string, violations: string[], nested: boolean): JsonSchemaNode {
  if (nested && field.required !== undefined) {
    violations.push(`${path}.required is only valid on a top-level parameter`);
  }
  if (nested && field.host !== undefined) {
    violations.push(`${path}.host is only valid on a top-level parameter`);
  }
  const node: JsonSchemaNode = { type: field.type };
  if (field.description !== undefined) node.description = field.description;
  if (field.enum !== undefined) node.enum = field.enum;
  const items = field.items;
  if (items !== undefined) {
    if (field.type !== "array") violations.push(`${path}.items is only valid with type "array"`);
    node.items = compileField(items, `${path}.items`, violations, true);
  }
  if (field.additionalProperties !== undefined) {
    if (field.type !== "object") violations.push(`${path}.additionalProperties is only valid with type "object"`);
    node.additionalProperties = field.additionalProperties;
  }
  return node;
}

interface CompiledParameters {
  published: JsonSchemaNode;
  validation: JsonSchemaNode;
  host_args: HostArg[];
}

function objectSchema(properties: Record<string, JsonSchemaNode>, required: string[]): JsonSchemaNode {
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

function compileParameters(parameters: Record<string, ParameterField>): CompiledParameters {
  const violations: string[] = [];
  const published: Record<string, JsonSchemaNode> = {};
  const validation: Record<string, JsonSchemaNode> = {};
  const publishedRequired: string[] = [];
  const validationRequired: string[] = [];
  const host_args: HostArg[] = [];
  for (const [name, field] of Object.entries(parameters)) {
    const schema = compileField(field, `parameters.${name}`, violations, false);
    const source = field.host;
    if (source === undefined) {
      published[name] = schema;
      if (field.required === true) publishedRequired.push(name);
      validation[name] = schema;
      if (field.required === true) validationRequired.push(name);
      continue;
    }
    if (!HOST_SOURCES.has(source)) {
      violations.push(`parameters.${name}.host ${JSON.stringify(source)} is not a known host source`);
    }
    if (field.type !== "string") violations.push(`parameters.${name}.host needs type "string"`);
    if (field.required === true) violations.push(`parameters.${name}.host is always required, drop required`);
    if (field.enum !== undefined) violations.push(`parameters.${name}.host cannot carry an enum`);
    host_args.push({ name, source });
    validation[name] = schema;
    validationRequired.push(name);
  }
  const publishedSchema = objectSchema(published, publishedRequired);
  const validationSchema = objectSchema(validation, validationRequired);
  try {
    assertSupportedJsonSchema(publishedSchema);
    assertSupportedJsonSchema(validationSchema);
  } catch (error) {
    if (error instanceof JsonSchemaError) violations.push(...error.violations);
    else throw error;
  }
  if (violations.length > 0) throw new JsonSchemaError(violations);
  return { published: publishedSchema, validation: validationSchema, host_args };
}

interface PreparedTool {
  name: string;
  capability: string;
  blueprint: ToolBlueprint;
  spec: ToolDescription;
  schema: JsonSchemaNode;
  policy: ToolPolicy;
}

export function defineTools(blueprints: readonly ToolBlueprint[]): ToolKit {
  const prepared = new Map<string, PreparedTool>();
  const provides: Provide[] = [];
  for (const blueprint of blueprints) {
    const problems: string[] = [];
    if (!CAPABILITY.test(blueprint.capability)) {
      problems.push(`capability ${JSON.stringify(blueprint.capability)} must look like tool.<name>`);
    }
    if (!SEMVER.test(blueprint.version)) {
      problems.push(`${blueprint.capability} version ${JSON.stringify(blueprint.version)} is not a full semver`);
    }
    if (blueprint.description.trim() === "") problems.push(`${blueprint.capability} needs a description`);
    const budget = blueprint.maxResultChars;
    if (budget !== undefined && budget !== null && !(Number.isInteger(budget) && budget > 0)) {
      problems.push(`${blueprint.capability} maxResultChars must be a positive integer or null`);
    }
    if (problems.length > 0) throw new Error(problems.join("; "));

    const name = blueprint.capability.slice("tool.".length);
    if (prepared.has(blueprint.capability)) throw new Error(`defineTools: ${blueprint.capability} is declared twice`);
    const compiled = compileParameters(blueprint.parameters);
    prepared.set(blueprint.capability, {
      name,
      capability: blueprint.capability,
      blueprint,
      spec: {
        name,
        description: blueprint.description,
        input_schema: compiled.published,
        host_args: compiled.host_args,
      },
      schema: compiled.validation,
      policy: {
        concurrency: typeof blueprint.concurrency === "string" ? blueprint.concurrency : "args",
        ...(budget === undefined ? {} : { max_result_chars: budget }),
      },
    });
    provides.push({ capability: blueprint.capability, version: blueprint.version });
  }

  const lookup = (call: Call): PreparedTool => {
    const found = prepared.get(call.capability);
    if (found === undefined) throw new CallError(-32602, `no tool ${JSON.stringify(call.capability)} in this plugin`);
    return found;
  };

  const safeToRun = (tool: PreparedTool, params: unknown): boolean => {
    if (validateParameters(tool.schema, params).length > 0) return false;
    const concurrency = tool.blueprint.concurrency;
    if (concurrency === "always") return true;
    if (concurrency === "never") return false;
    try {
      return concurrency.safe(argsOf(params)) === true;
    } catch {
      return false;
    }
  };

  return {
    provides,
    methods: {
      describe: (_params, call) => lookup(call).spec,
      policy: (_params, call) => lookup(call).policy,
      run: (params, call) => {
        const tool = lookup(call);
        const violations = validateParameters(tool.schema, params);
        if (violations.length > 0) throw new ToolArgsError(violations);
        return tool.blueprint.run(argsOf(params), call);
      },
      classify: (params, call) => ({ safe: safeToRun(lookup(call), params) }),
    },
  };
}