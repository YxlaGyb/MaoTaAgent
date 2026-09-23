import { CallError } from "./channel.ts";
import {
  assertSupportedJsonSchema,
  JsonSchemaError,
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type JsonSchemaScalar,
  type JsonSchemaType,
} from "./json-schema.ts";
import type { Call, Method } from "./plugin.ts";

export type ParameterType = JsonSchemaType;

export type HostSource = "session_cwd" | "session_id" | "call_id" | "subagent" | "session_touched";

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
  description: string;
  parameters: Record<string, ParameterField>;
  concurrency: Concurrency;
  maxResultChars?: number | null;
  paths?: readonly string[];
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
  paths?: string[];
}

export type ToolMethodName = "describe" | "policy" | "run" | "classify";

export interface ToolKit {
  provides: string[];
  methods: Record<ToolMethodName, Method>;
}

const CAPABILITY = /^tool\.[a-z][a-z0-9_]*$/;

const HOST_SOURCES = new Set<string>(["session_cwd", "session_id", "call_id", "subagent", "session_touched"]);

/// The host always knows where it is and which call it is running; it only
/// knows an asking subagent when a subagent is asking, so that one source may
/// be missing from the arguments.
const HOST_SOURCES_OPTIONAL = new Set<string>(["subagent", "session_touched"]);

/// Most host values are one string; the touched-path set is a list, so a host
/// parameter carries the type its source actually produces rather than being
/// bent into a string.
const HOST_SOURCES_LIST = new Set<string>(["session_touched"]);

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
  paths: string[];
}

function objectSchema(properties: Record<string, JsonSchemaNode>, required: string[]): JsonSchemaNode {
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

/// A tool that says which of its parameters carry a path lets the caller learn
/// which files the model actually touched, so a name that is not a string path
/// is refused here rather than turning into a silent non-match later.
function compilePaths(
  parameters: Record<string, ParameterField>,
  declared: readonly string[] | undefined,
  violations: string[],
): string[] {
  if (declared === undefined) return [];
  const paths: string[] = [];
  for (const name of declared) {
    if (paths.includes(name)) {
      violations.push(`paths lists ${JSON.stringify(name)} twice`);
      continue;
    }
    const field = parameters[name];
    if (field === undefined) {
      violations.push(`paths names ${JSON.stringify(name)}, which parameters does not declare`);
      continue;
    }
    if (field.host !== undefined) {
      violations.push(`parameters.${name}.host cannot be declared in paths`);
      continue;
    }
    const scalar = field.type === "string";
    const list = field.type === "array" && field.items?.type === "string";
    if (!scalar && !list) {
      violations.push(`parameters.${name} carries no path: declare it as type "string" or an array of string`);
      continue;
    }
    paths.push(name);
  }
  return paths;
}

function compileParameters(parameters: Record<string, ParameterField>, declaredPaths?: readonly string[]): CompiledParameters {
  const violations: string[] = [];
  const published: Record<string, JsonSchemaNode> = {};
  const validation: Record<string, JsonSchemaNode> = {};
  const publishedRequired: string[] = [];
  const validationRequired: string[] = [];
  const host_args: HostArg[] = [];
  const paths = compilePaths(parameters, declaredPaths, violations);
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
    const wanted = HOST_SOURCES_LIST.has(source) ? ["array"] : ["string", "object"];
    if (!wanted.includes(field.type)) {
      violations.push(`parameters.${name}.host needs type ${wanted.map((kind) => JSON.stringify(kind)).join(" or ")}`);
    }
    if (field.required === true) violations.push(`parameters.${name}.host is always required, drop required`);
    if (field.enum !== undefined) violations.push(`parameters.${name}.host cannot carry an enum`);
    host_args.push({ name, source });
    validation[name] = schema;
    if (!HOST_SOURCES_OPTIONAL.has(source)) validationRequired.push(name);
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
  return { published: publishedSchema, validation: validationSchema, host_args, paths };
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
  const provides: string[] = [];
  for (const blueprint of blueprints) {
    const problems: string[] = [];
    if (!CAPABILITY.test(blueprint.capability)) {
      problems.push(`capability ${JSON.stringify(blueprint.capability)} must look like tool.<name>`);
    }
    if (blueprint.description.trim() === "") problems.push(`${blueprint.capability} needs a description`);
    const budget = blueprint.maxResultChars;
    if (budget !== undefined && budget !== null && !(Number.isInteger(budget) && budget > 0)) {
      problems.push(`${blueprint.capability} maxResultChars must be a positive integer or null`);
    }
    if (problems.length > 0) throw new Error(problems.join("; "));

    const name = blueprint.capability.slice("tool.".length);
    if (prepared.has(blueprint.capability)) throw new Error(`defineTools: ${blueprint.capability} is declared twice`);
    const compiled = compileParameters(blueprint.parameters, blueprint.paths);
    prepared.set(blueprint.capability, {
      name,
      capability: blueprint.capability,
      blueprint,
      spec: {
        name,
        description: blueprint.description,
        input_schema: compiled.published,
        host_args: compiled.host_args,
        paths: compiled.paths,
      },
      schema: compiled.validation,
      policy: {
        concurrency: typeof blueprint.concurrency === "string" ? blueprint.concurrency : "args",
        ...(budget === undefined ? {} : { max_result_chars: budget }),
      },
    });
    provides.push(blueprint.capability);
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
