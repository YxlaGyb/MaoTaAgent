export type JsonSchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export type JsonSchemaScalar = string | number | boolean | null;

export interface JsonSchemaNode {
  type?: JsonSchemaType;
  oneOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  enum?: JsonSchemaScalar[];
  const?: JsonSchemaScalar;
  description?: string;
  title?: string;
  default?: unknown;
}

const KEYWORDS = new Set([
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "description",
  "title",
  "default",
]);

const TYPES = new Set<string>(["object", "array", "string", "number", "integer", "boolean", "null"]);

const SCALAR_TYPES = new Set<string>(["string", "number", "integer", "boolean", "null"]);

export class JsonSchemaError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`unsupported JSON schema: ${violations.join("; ")}`);
    this.name = "JsonSchemaError";
    this.violations = violations;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is JsonSchemaScalar {
  return (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  );
}

function isJsonValue(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const inside = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return inside;
}

function matchesType(type: JsonSchemaType, value: unknown): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}

export function assertSupportedJsonSchema(schema: unknown): asserts schema is JsonSchemaNode {
  const violations: string[] = [];
  checkSchema(schema, "schema", violations, new Set());
  if (violations.length > 0) throw new JsonSchemaError(violations);
}

function checkSchema(node: unknown, path: string, violations: string[], open: Set<unknown>): void {
  if (!isRecord(node)) {
    violations.push(`${path} must be a JSON object`);
    return;
  }
  if (open.has(node)) {
    violations.push(`${path} is a cycle`);
    return;
  }
  open.add(node);
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key)) violations.push(`${path}.${key} is not a supported keyword`);
  }
  const type = node.type;
  if (type !== undefined && (typeof type !== "string" || !TYPES.has(type))) {
    violations.push(`${path}.type is not one of ${[...TYPES].join(", ")}`);
  }
  if (node.oneOf !== undefined) {
    if (type !== undefined) violations.push(`${path}.oneOf cannot be combined with type`);
    if (!Array.isArray(node.oneOf)) violations.push(`${path}.oneOf must be an array`);
    else if (node.oneOf.length < 2) violations.push(`${path}.oneOf needs at least two branches`);
    else node.oneOf.forEach((branch, index) => checkSchema(branch, `${path}.oneOf[${index}]`, violations, open));
  }
  if (node.properties !== undefined) {
    if (type !== "object") violations.push(`${path}.properties is only valid with type "object"`);
    if (!isRecord(node.properties)) violations.push(`${path}.properties must be an object`);
    else {
      for (const [key, value] of Object.entries(node.properties)) {
        checkSchema(value, `${path}.properties.${key}`, violations, open);
      }
    }
  }
  if (node.required !== undefined) {
    if (type !== "object") violations.push(`${path}.required is only valid with type "object"`);
    if (!Array.isArray(node.required)) violations.push(`${path}.required must be an array`);
    else {
      const declared = isRecord(node.properties) ? node.properties : {};
      node.required.forEach((key, index) => {
        if (typeof key !== "string") violations.push(`${path}.required[${index}] must be a string`);
        else if (!Object.hasOwn(declared, key)) {
          violations.push(`${path}.required names ${JSON.stringify(key)}, which ${path}.properties does not declare`);
        }
      });
    }
  }
  if (node.additionalProperties !== undefined) {
    if (type !== "object") violations.push(`${path}.additionalProperties is only valid with type "object"`);
    if (typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
  }
  if (node.items !== undefined) {
    if (type !== "array") violations.push(`${path}.items is only valid with type "array"`);
    checkSchema(node.items, `${path}.items`, violations, open);
  }
  if (node.enum !== undefined) {
    if (type === undefined || typeof type !== "string" || !SCALAR_TYPES.has(type)) {
      violations.push(`${path}.enum is only valid on a scalar type`);
    }
    if (!Array.isArray(node.enum)) violations.push(`${path}.enum must be an array`);
    else {
      node.enum.forEach((item, index) => {
        if (!isScalar(item)) violations.push(`${path}.enum[${index}] is not a scalar`);
        else if (typeof type === "string" && TYPES.has(type) && !matchesType(type as JsonSchemaType, item)) {
          violations.push(`${path}.enum[${index}] is not a ${type}`);
        }
      });
    }
  }
  if (node.const !== undefined) {
    if (type === undefined || typeof type !== "string" || !SCALAR_TYPES.has(type)) {
      violations.push(`${path}.const is only valid on a scalar type`);
    }
    if (!isScalar(node.const)) violations.push(`${path}.const is not a scalar`);
    else if (typeof type === "string" && TYPES.has(type) && !matchesType(type as JsonSchemaType, node.const)) {
      violations.push(`${path}.const is not a ${type}`);
    }
  }
  if (node.description !== undefined && typeof node.description !== "string") {
    violations.push(`${path}.description must be a string`);
  }
  if (node.title !== undefined && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
  if (node.default !== undefined && !isJsonValue(node.default)) {
    violations.push(`${path}.default is not lossless JSON`);
  }
  open.delete(node);
}

export function validateJsonSchemaValue(schema: JsonSchemaNode, value: unknown, path = "value"): string[] {
  const violations: string[] = [];
  checkValue(schema, value, path, violations);
  return violations;
}

function checkValue(node: JsonSchemaNode, value: unknown, path: string, violations: string[]): void {
  if (node.oneOf !== undefined) {
    const matches = node.oneOf.filter((branch) => validateJsonSchemaValue(branch, value, path).length === 0);
    if (matches.length === 0) violations.push(`${path} does not match any of the ${node.oneOf.length} oneOf branches`);
    else if (matches.length > 1) violations.push(`${path} matches ${matches.length} oneOf branches, exactly one is allowed`);
    return;
  }
  if (node.const !== undefined && value !== node.const) {
    violations.push(`${path} must be ${JSON.stringify(node.const)}`);
    return;
  }
  if (node.enum !== undefined && !node.enum.some((item) => item === value)) {
    violations.push(`${path} must be one of ${node.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  const type = node.type;
  if (type === undefined) return;
  if (type === "object") {
    if (!isRecord(value)) {
      violations.push(`${path} must be an object`);
      return;
    }
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) violations.push(`${path}.${key} is required`);
    }
    const properties = node.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
      checkValue(child, value[key], `${path}.${key}`, violations);
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) violations.push(`${path}.${key} is not a declared property`);
      }
    }
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      violations.push(`${path} must be an array`);
      return;
    }
    const items = node.items;
    if (items !== undefined) {
      value.forEach((item, index) => checkValue(items, item, `${path}[${index}]`, violations));
    }
    return;
  }
  if (!matchesType(type, value)) violations.push(`${path} must be ${type === "integer" ? "an" : "a"} ${type}`);
}
