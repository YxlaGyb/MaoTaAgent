import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Call } from "@maota/plugin-kit";
import {
  configure,
  deleteModel,
  keyFor,
  resolveModel,
  saveModel,
  saveProvider,
  setDefault,
  view,
} from "../src/catalog.ts";
import { addAdapter, setRoutes } from "../src/registry.ts";

const home = mkdtempSync(join(tmpdir(), "maota-model-router-"));
process.env.MAOTA_HOME = home;

function ctx(): Call {
  return {
    capabilities: { "model.adapter.openai": { plugin: "model-openai" } },
    channel: {
      call: async (capability: string, method: string) => {
        if (capability === "model.adapter.openai" && method === "describe") {
          return { id: "openai", name: "OpenAI" };
        }
        throw new Error(`unexpected call ${capability}/${method}`);
      },
    },
    signal: new AbortController().signal,
  } as unknown as Call;
}

const call = ctx();
setRoutes({ "model.adapter.openai": { plugin: "model-openai" } });
addAdapter("model.adapter.openai", "model-openai");
const settings = configure({ file: join(home, "models.json") });
assert.equal(settings.store.file, join(home, "models.json"));

const firstProvider = saveProvider(call, {
  name: "First",
  adapter: "openai",
  base_url: "https://example.test/v1/",
  api_key: "sk-first",
  expected_revision: 0,
});
assert.equal(firstProvider.revision, 1);
assert.equal(firstProvider.providers[0]?.id.length, 36, "a new provider gets an immutable UUID");
const provider = firstProvider.providers[0]!;
assert.equal(keyFor(provider), "sk-first");
if (process.platform !== "win32") {
  assert.equal(statSync(join(home, "credentials", `${provider.id}.key`)).mode & 0o777, 0o600);
}

const withModel = saveModel(call, {
  provider: provider.id,
  model: "fast",
  name: "Fast",
  context_tokens: 32_000,
  capabilities: { tools: true, vision: false },
  reasoning_efforts: ["low", "high"],
  expected_revision: 1,
});
assert.equal(withModel.revision, 2);
assert.deepEqual(withModel.default_route, { provider: provider.id, model: "fast" });
assert.deepEqual(resolveModel(withModel, { level: "high", model: "fast" }).route, {
  provider: provider.id,
  model: "fast",
  reasoning: "high",
});
assert.equal(resolveModel(withModel, { level: "off" }).route.reasoning, undefined);
assert.throws(() => resolveModel({ ...withModel, default_route: null }, { level: "high" }), (error: { code?: number }) => error.code === -32602);
assert.throws(() => resolveModel(withModel, { route: { provider: "api", model: "selected" }, strict: true }), (error: { code?: number }) => error.code === -32602);

const paused = saveProvider(call, {
  id: provider.id,
  name: provider.name,
  adapter: provider.adapter,
  base_url: provider.base_url,
  auth: provider.auth,
  enabled: false,
  verified: provider.verified,
  expected_revision: withModel.revision,
});
assert.equal(paused.providers[0]?.enabled, false);
assert.equal(paused.default_route, null);
assert.throws(
  () => resolveModel(paused, { route: { provider: provider.id, model: "fast" }, strict: true }),
  (error: { code?: number }) => error.code === -32602,
);
const resumed = saveProvider(call, {
  id: provider.id,
  name: provider.name,
  adapter: provider.adapter,
  base_url: provider.base_url,
  auth: provider.auth,
  enabled: true,
  verified: provider.verified,
  expected_revision: paused.revision,
});

assert.throws(
  () => saveModel(call, { provider: provider.id, model: "stale", expected_revision: 0 }),
  (error: { code?: number }) => error.code === -32059,
);

const secondModel = saveModel(call, {
  provider: provider.id,
  model: "safe",
  name: "Safe",
  capabilities: { tools: true, vision: false },
  expected_revision: resumed.revision,
});
const second = saveModel(call, {
  provider: provider.id,
  model: "safe",
  name: "Safe",
  capabilities: { tools: true, vision: false },
  expected_revision: secondModel.revision,
});
const retargeted = setDefault(call, {
  route: { provider: provider.id, model: "safe" },
  expected_revision: second.revision,
});
const defaultFast = setDefault(call, {
  route: { provider: provider.id, model: "fast" },
  expected_revision: retargeted.revision,
});
const removed = deleteModel(call, {
  provider: provider.id,
  model: "fast",
  expected_revision: defaultFast.revision,
});
assert.equal(removed.models.some((model) => model.model === "fast"), false);
assert.deepEqual(removed.default_route, { provider: provider.id, model: "safe" });

const envProvider = saveProvider(call, {
  name: "Env",
  adapter: "openai",
  base_url: "https://env.example/v1",
  auth: { kind: "env", name: "MAOTA_TEST_KEY" },
  expected_revision: removed.revision,
});
process.env.MAOTA_TEST_KEY = "sk-env";
assert.equal(keyFor(envProvider.providers[1]!), "sk-env");

const listed = await view(call);
assert.equal((listed.providers as Array<{ id: string }>)[0]?.id, provider.id);
assert.equal((listed.adapters as Array<{ id: string }>)[0]?.id, "openai");
assert.equal(readdirSync(home).some((name) => name.includes(".tmp-")), false, "atomic write left no temp file");
assert.equal(existsSync(join(home, "models.json")), true);

console.log("model router ok: discovery, storage, revision, priority, keys and atomic writes");
