import assert from "node:assert/strict";

import { CallError } from "./channel.ts";
import { matchesAnyPath, matchesPath, patternToRegExp, toPosix } from "./glob.ts";
import { assertSupportedJsonSchema, JsonSchemaError } from "./json-schema.ts";
import { defineTools, ToolArgsError, validateParameters, type ToolBlueprint } from "./tool.ts";
import type { Call } from "./plugin.ts";

import type { JsonSchemaNode } from "./json-schema.ts";



function schemaViolations(schema: unknown): string[] {
  try {
    assertSupportedJsonSchema(schema);
    return [];
  } catch (error) {
    if (error instanceof JsonSchemaError) return error.violations;
    throw error;
  }
}

const call = (capability: string): Call => ({ capability }) as Call;

assert.deepEqual(schemaViolations("nope"), ["schema must be a JSON object"]);
assert.deepEqual(schemaViolations({ type: "object", properties: { a: { type: "string" } } }), []);
assert.deepEqual(schemaViolations({ pattern: "^a$" }), ["schema.pattern is not a supported keyword"]);
assert.deepEqual(schemaViolations({ type: "string", items: { type: "string" } }), [
  'schema.items is only valid with type "array"',
]);
assert.deepEqual(schemaViolations({ type: "string", oneOf: [{ type: "string" }, { type: "number" }] }), [
  "schema.oneOf cannot be combined with type",
]);
assert.deepEqual(schemaViolations({ oneOf: [{ type: "object" }] }), [
  "schema.oneOf needs at least two branches",
]);
assert.deepEqual(schemaViolations({ type: "object", required: ["a"] }), [
  'schema.required names "a", which schema.properties does not declare',
]);
assert.deepEqual(schemaViolations({ type: "object", additionalProperties: "no" }), [
  "schema.additionalProperties must be a boolean",
]);
assert.deepEqual(schemaViolations({ type: "integer", enum: ["x"] }), ['schema.enum[0] is not a integer']);
assert.deepEqual(schemaViolations({ type: "object", default: undefined }), []);

const cyclic: Record<string, unknown> = { type: "object" };
cyclic.properties = { self: cyclic };

assert.deepEqual(schemaViolations(cyclic), ["schema.properties.self is a cycle"]);

const shape: JsonSchemaNode = {
  type: "object",
  properties: { path: { type: "string" }, limit: { type: "integer" } },
  required: ["path"],
};

assert.deepEqual(validateParameters(shape, { path: "a" }), []);
assert.deepEqual(validateParameters(shape, { path: "a", limit: 3 }), []);
assert.deepEqual(validateParameters(shape, {}), ["arguments.path is required"]);
assert.deepEqual(validateParameters(shape, undefined), ["arguments.path is required"]);
assert.deepEqual(validateParameters(shape, null), ["arguments.path is required"]);
assert.deepEqual(validateParameters(shape, { path: "a", limit: 1.5 }), ["arguments.limit must be an integer"]);
assert.deepEqual(validateParameters(shape, { path: 1, limit: "2" }), [
  "arguments.path must be a string",
  "arguments.limit must be an integer",
]);
assert.deepEqual(
  validateParameters({ type: "object", properties: { kind: { type: "string", enum: ["a", "b"] } } }, { kind: "c" }),
  ['arguments.kind must be one of "a", "b"'],
);
assert.deepEqual(
  validateParameters({ type: "object", properties: { kind: { type: "string", enum: ["a"] } } }, {}),
  [],
);
assert.deepEqual(validateParameters({ type: "array", items: { type: "integer" } }, [1, 2.5]), [
  "arguments[1] must be an integer",
]);
assert.deepEqual(
  validateParameters({ type: "object", additionalProperties: false, properties: { a: { type: "string" } } }, { a: "x", b: 1 }),
  ["arguments.b is not a declared property"],
);
assert.deepEqual(validateParameters({ oneOf: [{ type: "string" }, { type: "number" }] }, true), [
  "arguments does not match any of the 2 oneOf branches",
]);
assert.deepEqual(validateParameters({ oneOf: [{ type: "number" }, { type: "integer" }] }, 2), [
  "arguments matches 2 oneOf branches, exactly one is allowed",
]);
assert.deepEqual(validateParameters({ type: "array" }, []), []);

const echo: ToolBlueprint = {
  capability: "tool.echo",
  version: "1.0.0",
  description: "Echo one value back.",
  parameters: { value: { type: "string", required: true, description: "The value." } },
  concurrency: "always",
  run: (args) => ({ echoed: args.value }),
};

const writer: ToolBlueprint = {
  capability: "tool.write",
  version: "1.0.0",
  description: "Write one value.",
  parameters: { value: { type: "string", required: true }, dry_run: { type: "boolean" } },
  concurrency: { safe: (args) => args.dry_run === true },
  maxResultChars: null,
  run: (args) => ({ wrote: args.value }),
};

const reader: ToolBlueprint = {
  capability: "tool.read",
  version: "1.0.0",
  description: "Read one file.",
  parameters: {
    file_path: { type: "string", required: true },
    cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
  },
  concurrency: "always",
  maxResultChars: null,
  paths: ["file_path"],
  run: (args) => ({ read: args.file_path, from: args.cwd }),
};

const hosted = defineTools([reader]);

const hostedAll: ToolBlueprint = {
  ...reader,
  parameters: {
    file_path: { type: "string", required: true },
    cwd: { type: "string", host: "session_cwd", description: "The session working directory." },
    session_id: { type: "string", host: "session_id", description: "The session id." },
    call_id: { type: "string", host: "call_id", description: "The tool call id." },
    subagent: { type: "object", host: "subagent", description: "The subagent asking, when one is." },
  },
};

const everyHost = defineTools([hostedAll]);
assert.deepEqual(everyHost.methods.describe({}, call("tool.read")), {
  name: "read",
  description: "Read one file.",
  input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
  host_args: [
    { name: "cwd", source: "session_cwd" },
    { name: "session_id", source: "session_id" },
    { name: "call_id", source: "call_id" },
    { name: "subagent", source: "subagent" },
  ],
  paths: ["file_path"],
});

assert.deepEqual(await everyHost.methods.run({ file_path: "a", cwd: "E:\\x", session_id: "s1", call_id: "c1" }, call("tool.read")), {
  read: "a",
  from: "E:\\x",
});

assert.deepEqual(
  await everyHost.methods.run(
    { file_path: "a", cwd: "E:\\x", session_id: "s1", call_id: "c1", subagent: { id: "sub-1", type: "explore" } },
    call("tool.read"),
  ),
  { read: "a", from: "E:\\x" },
);

assert.deepEqual(hosted.methods.describe({}, call("tool.read")), {
  name: "read",
  description: "Read one file.",
  input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
  host_args: [{ name: "cwd", source: "session_cwd" }],
  paths: ["file_path"],
});

assert.deepEqual(await hosted.methods.run({ file_path: "a", cwd: "E:\\x" }, call("tool.read")), {
  read: "a",
  from: "E:\\x",
});

assert.deepEqual(await hosted.methods.classify({ file_path: "a", cwd: "E:\\x" }, call("tool.read")), { safe: true });
assert.deepEqual(await hosted.methods.classify({ file_path: "a" }, call("tool.read")), { safe: false });

const noCwd = await (async () => {
  try {
    await hosted.methods.run({ file_path: "a" }, call("tool.read"));
    return null;
  } catch (error) {
    return error as ToolArgsError;
  }
})();

assert.ok(noCwd instanceof ToolArgsError);
assert.equal(noCwd.message, "invalid arguments: arguments.cwd is required");
assert.deepEqual(noCwd.violations, ["arguments.cwd is required"]);

assert.throws(
  () => defineTools([{ ...reader, parameters: { cwd: { type: "string", host: "session_cwd", required: true } } }]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes("parameters.cwd.host is always required, drop required"),
);

assert.throws(
  () => defineTools([{ ...reader, parameters: { cwd: { type: "integer", host: "session_cwd" } } }]),
  (error: unknown) =>
    error instanceof JsonSchemaError && error.violations.includes('parameters.cwd.host needs type "string" or "object"'),
);

assert.throws(
  () =>
    defineTools([
      { ...reader, parameters: { cwd: { type: "string", host: "elsewhere" as unknown as "session_cwd" } } },
    ]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes('parameters.cwd.host "elsewhere" is not a known host source'),
);

assert.throws(
  () =>
    defineTools([
      {
        ...reader,
        parameters: { list: { type: "array", items: { type: "string", host: "session_cwd" } } },
      },
    ]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes("parameters.list.items.host is only valid on a top-level parameter"),
);

const kit = defineTools([echo, writer]);

assert.deepEqual(kit.provides, [
  { capability: "tool.echo", version: "1.0.0" },
  { capability: "tool.write", version: "1.0.0" },
]);

assert.deepEqual(kit.methods.describe({}, call("tool.echo")), {
  name: "echo",
  description: "Echo one value back.",
  input_schema: {
    type: "object",
    properties: { value: { type: "string", description: "The value." } },
    required: ["value"],
  },
  host_args: [],
  paths: [],
});

assert.deepEqual(kit.methods.policy({}, call("tool.echo")), { concurrency: "always" });
assert.deepEqual(kit.methods.policy({}, call("tool.write")), { concurrency: "args", max_result_chars: null });
assert.deepEqual(await kit.methods.run({ value: "x" }, call("tool.echo")), { echoed: "x" });
assert.deepEqual(await kit.methods.classify({ value: "x" }, call("tool.echo")), { safe: true });
assert.deepEqual(await kit.methods.classify({ value: "x" }, call("tool.write")), { safe: false });
assert.deepEqual(await kit.methods.classify({ value: "x", dry_run: true }, call("tool.write")), { safe: true });
assert.deepEqual(await kit.methods.classify({}, call("tool.write")), { safe: false });

const refused = await (async () => {
  try {
    await kit.methods.run({}, call("tool.echo"));
    return null;
  } catch (error) {
    return error as ToolArgsError;
  }
})();

assert.ok(refused instanceof ToolArgsError);
assert.equal(refused.code, -32602);
assert.equal(refused.message, "invalid arguments: arguments.value is required");
assert.deepEqual(refused.violations, ["arguments.value is required"]);
assert.deepEqual(refused.data, { code: "INVALID_ARGS", violations: ["arguments.value is required"] });

const missing = (() => {
  try {
    kit.methods.describe({}, call("tool.nope"));
    return null;
  } catch (error) {
    return error;
  }
})();

assert.ok(missing instanceof CallError);
assert.equal(missing.code, -32602);

assert.throws(() => defineTools([{ ...echo, capability: "echo" }]), /must look like tool\.<name>/);
assert.throws(() => defineTools([{ ...echo, version: "1.0" }]), /is not a full semver/);
assert.throws(() => defineTools([echo, echo]), /declared twice/);
assert.throws(
  () =>
    defineTools([
      {
        ...echo,
        parameters: { list: { type: "array", items: { type: "string", required: true } } },
      },
    ]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes("parameters.list.items.required is only valid on a top-level parameter"),
);

assert.equal(patternToRegExp("**/*.ts").test("a.ts"), true);
assert.equal(patternToRegExp("**/*.ts").test("src/a.ts"), true);
assert.equal(patternToRegExp("**/*.ts").test("src/a.md"), false);
assert.equal(patternToRegExp("src/*.ts").test("src/a.ts"), true);
assert.equal(patternToRegExp("src/*.ts").test("src/deep/a.ts"), false);
assert.equal(toPosix("src\\ui\\a.tsx"), "src/ui/a.tsx");
assert.equal(matchesPath("src/ui/**", "src/ui/a.tsx", false), true);
assert.equal(matchesPath("src/ui/**", "src/db/a.ts", false), false);
assert.equal(matchesPath("**/*.tsx", "a.tsx", false), true);
assert.equal(matchesPath("src/ui", "src/ui", false), true);
assert.equal(matchesPath("src/ui", "src/ui/a.tsx", false), true);
assert.equal(matchesPath("src/ui", "src/ui2/a.tsx", false), false);
assert.equal(matchesPath("", "a.ts", false), false);
assert.equal(matchesPath("src/ui/**", "SRC/UI/A.TSX", true), true);
assert.equal(matchesPath("src/ui/**", "SRC/UI/A.TSX", false), false);
assert.equal(matchesAnyPath(undefined, ["a.ts"]), true);
assert.equal(matchesAnyPath([], ["a.ts"]), true);
assert.equal(matchesAnyPath(["src/**"], ["a.ts"]), false);
assert.equal(matchesAnyPath(["src/**"], ["", "src/a.ts"]), true);

const listed: ToolBlueprint = {
  ...reader,
  parameters: { files: { type: "array", items: { type: "string" } } },
  paths: ["files"],
};

assert.deepEqual((defineTools([listed]).methods.describe({}, call("tool.read")) as { paths: string[] }).paths, ["files"]);

assert.throws(
  () => defineTools([{ ...reader, paths: ["nope"] }]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes('paths names "nope", which parameters does not declare'),
);

assert.throws(
  () => defineTools([{ ...reader, paths: ["file_path", "file_path"] }]),
  (error: unknown) =>
    error instanceof JsonSchemaError && error.violations.includes('paths lists "file_path" twice'),
);

assert.throws(
  () => defineTools([{ ...reader, paths: ["cwd"] }]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes("parameters.cwd.host cannot be declared in paths"),
);

assert.throws(
  () => defineTools([{ ...writer, paths: ["dry_run"] }]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes('parameters.dry_run carries no path: declare it as type "string" or an array of string'),
);

assert.throws(
  () =>
    defineTools([
      { ...reader, parameters: { files: { type: "array", items: { type: "integer" } } }, paths: ["files"] },
    ]),
  (error: unknown) =>
    error instanceof JsonSchemaError
    && error.violations.includes('parameters.files carries no path: declare it as type "string" or an array of string'),
);

console.log("ok   plugin-kit tool schema: keywords, values, host args, paths, errors");
