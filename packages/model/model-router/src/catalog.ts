import { randomUUID } from "node:crypto";

import { CallError, type Call } from "@maota/plugin-kit";
import {
  findModel,
  findProvider,
  keyConfigured,
  readCatalogFile,
  readProviderKey,
  removeProviderKey,
  requireRevision,
  storeSettings,
  writeCatalogFile,
  writeProviderKey,
  type StoreSettings,
} from "./store.ts";
import {
  readModelInput,
  readProviderInput,
  readRoute,
  type AdapterDescriptor,
  type ModelCatalog,
  type ModelRoute,
  type ThinkingLevel,
  type ProviderProfile,
  type ResolvedModel,
} from "@maota/model-protocol";

export interface CatalogSettings {
  store: StoreSettings;
  idle_timeout_ms: number;
}

let settings: CatalogSettings = { store: storeSettings({}), idle_timeout_ms: 120_000 };

export function configure(config: Record<string, unknown>): CatalogSettings {
  const idle = Number(config.stream_idle_timeout_ms);
  settings = {
    store: storeSettings(config),
    idle_timeout_ms: Number.isFinite(idle) && idle >= 0 ? Math.floor(idle) : 120_000,
  };
  return settings;
}

export function catalogSettings(): CatalogSettings {
  return settings;
}

export function catalog(_ctx: Call): ModelCatalog {
  return readCatalogFile(settings.store);
}

function save(value: ModelCatalog): ModelCatalog {
  const next = { ...value, revision: value.revision + 1 };
  writeCatalogFile(settings.store, next);
  return next;
}

function adapterCapability(adapter: string): string {
  return `model.adapter.${adapter}`;
}

function requireAdapter(ctx: Call, adapter: string): string {
  const capability = adapterCapability(adapter);
  if (ctx.capabilities[capability] === undefined) throw new CallError(-32602, `unknown adapter: ${adapter}`);
  return capability;
}

export async function adapterDescriptors(ctx: Call): Promise<AdapterDescriptor[]> {
  const found: AdapterDescriptor[] = [];
  for (const capability of Object.keys(ctx.capabilities)) {
    if (!capability.startsWith("model.adapter.")) continue;
    const reply = await ctx.channel.call(capability, "describe", {}, { signal: ctx.signal });
    if (reply !== null && typeof reply === "object" && typeof (reply as { id?: unknown }).id === "string") {
      found.push(reply as AdapterDescriptor);
    }
  }
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

export async function view(ctx: Call): Promise<Record<string, unknown>> {
  const value = catalog(ctx);
  return {
    ...value,
    providers: value.providers.map((provider) => ({
      ...provider,
      key_configured: keyConfigured(settings.store, provider),
      key_source: provider.auth.kind,
    })),
    adapters: await adapterDescriptors(ctx),
  };
}

function checkedRoute(value: ModelCatalog, route: ModelRoute): ModelRoute {
  const model = findModel(value, route.provider, route.model);
  if (route.reasoning !== undefined && !model.reasoning_efforts.includes(route.reasoning)) {
    throw new CallError(-32602, `model ${route.model} does not offer reasoning ${route.reasoning}`);
  }
  return route;
}

function inputRoute(value: unknown): ModelRoute | null {
  if (value === null || value === undefined) return null;
  return readRoute(value);
}

function replacement(value: ModelCatalog, raw: unknown): ModelRoute | null {
  const route = inputRoute(raw);
  return route === null ? null : checkedRoute(value, route);
}

function fallbackRoute(value: ModelCatalog, exclude: (model: ModelCatalog["models"][number]) => boolean = () => false): ModelRoute | null {
  for (const model of value.models) {
    if (!model.enabled || exclude(model)) continue;
    const provider = value.providers.find((item) => item.id === model.provider);
    if (provider?.enabled) return { provider: model.provider, model: model.model };
  }
  return null;
}

export interface ResolveInput {
  route?: ModelRoute;
  level?: ThinkingLevel;
  model?: string;
  strict?: boolean;
}

export function resolveModel(value: ModelCatalog, input: ResolveInput = {}): ResolvedModel {
  let route = input.route;
  if (route !== undefined) {
    try {
      route = checkedRoute(value, route);
    } catch {
      if (input.strict === true) throw new CallError(-32602, "the requested model route is not configured");
      route = undefined;
    }
  }
  if (route === undefined && input.model !== undefined && input.model.trim() !== "") {
    const matches = value.models.filter((model) => model.model === input.model || model.name === input.model);
    if (matches.length !== 1) throw new CallError(-32602, "model " + input.model + " is not configured");
    const match = matches[0];
    if (match === undefined) throw new CallError(-32602, "model " + input.model + " is not configured");
    route = { provider: match.provider, model: match.model };
  }
  route ??= value.default_route ?? undefined;
  if (route === undefined) throw new CallError(-32602, "no model is configured");
  const valid = checkedRoute(value, route);
  const provider = findProvider(value, valid.provider);
  if (!provider.enabled) throw new CallError(-32602, "provider " + provider.id + " is disabled");
  const model = findModel(value, valid.provider, valid.model);
  if (!model.enabled) throw new CallError(-32602, "model " + model.provider + "/" + model.model + " is disabled");
  const requested = input.level === "off" ? undefined : input.level;
  const reasoning = valid.reasoning ??
    (requested === undefined
      ? undefined
      : model.reasoning_efforts.includes(requested)
        ? requested
        : model.reasoning_efforts[0]);
  return {
    route: { provider: valid.provider, model: valid.model, ...(reasoning === undefined ? {} : { reasoning }) },
    provider,
    model,
  };
}

export async function discover(ctx: Call, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const adapter = typeof params.adapter === "string" ? params.adapter.trim() : "";
  const base_url = typeof params.base_url === "string" ? params.base_url.trim() : "";
  const api_key = typeof params.api_key === "string" ? params.api_key.trim() : "";
  if (adapter === "" || base_url === "") throw new CallError(-32602, "discover needs adapter and base_url");
  const models = await ctx.channel.call(requireAdapter(ctx, adapter), "discover", { base_url, api_key }, { signal: ctx.signal });
  return { verified: true, models };
}

export function saveProvider(ctx: Call, params: Record<string, unknown>): ModelCatalog {
  const input = readProviderInput(params);
  requireAdapter(ctx, input.adapter);
  const current = catalog(ctx);
  requireRevision(current, params.expected_revision);
  const existing = input.id === undefined ? undefined : current.providers.find((item) => item.id === input.id);
  const id = existing?.id ?? input.id ?? randomUUID();
  const apiKey = typeof params.api_key === "string" ? params.api_key.trim() : "";
  const provider: ProviderProfile = {
    id,
    name: input.name,
    adapter: input.adapter,
    base_url: input.base_url.replace(/\/+$/, ""),
    auth: apiKey === "" ? input.auth ?? existing?.auth ?? { kind: "file" } : { kind: "file" },
    enabled: input.enabled ?? existing?.enabled ?? true,
    verified: input.verified === true,
  };
  if (apiKey !== "") writeProviderKey(settings.store, id, apiKey);
  const providers = existing === undefined
    ? [...current.providers, provider]
    : current.providers.map((item) => item.id === id ? provider : item);
  const next = { ...current, providers };
  const default_route = current.default_route?.provider === id && !provider.enabled
    ? fallbackRoute(next)
    : current.default_route;
  return save({ ...next, default_route });
}

export function deleteProvider(ctx: Call, params: Record<string, unknown>): ModelCatalog {
  const current = catalog(ctx);
  requireRevision(current, params.expected_revision);
  const id = typeof params.id === "string" ? params.id : "";
  findProvider(current, id);
  const providers = current.providers.filter((item) => item.id !== id);
  const models = current.models.filter((item) => item.provider !== id);
  const next = { ...current, providers, models };
  let default_route = current.default_route;
  if (default_route?.provider === id) {
    default_route = replacement(current, params.replacement) ?? fallbackRoute(next);
    if (default_route?.provider === id) default_route = fallbackRoute(next);
  }
  removeProviderKey(settings.store, id);
  return save({ ...next, default_route });
}

export function saveModel(ctx: Call, params: Record<string, unknown>): ModelCatalog {
  const input = readModelInput(params);
  const current = catalog(ctx);
  requireRevision(current, params.expected_revision);
  findProvider(current, input.provider);
  const existing = current.models.find((item) => item.provider === input.provider && item.model === input.model);
  const model = {
    provider: input.provider,
    model: input.model,
    name: input.name ?? input.model,
    ...(input.context_tokens === undefined ? {} : { context_tokens: input.context_tokens }),
    ...(input.max_output_tokens === undefined ? {} : { max_output_tokens: input.max_output_tokens }),
    capabilities: { tools: input.capabilities?.tools !== false, vision: input.capabilities?.vision === true },
    reasoning_efforts: input.reasoning_efforts ?? [],
    enabled: input.enabled ?? existing?.enabled ?? true,
    verified: input.verified === true,
  };
  const models = current.models.some((item) => item.provider === model.provider && item.model === model.model)
    ? current.models.map((item) => item.provider === model.provider && item.model === model.model ? model : item)
    : [...current.models, model];
  const next = { ...current, models };
  const default_route = current.default_route?.provider === model.provider && current.default_route.model === model.model && !model.enabled
    ? fallbackRoute(next)
    : current.default_route ?? (model.enabled ? { provider: model.provider, model: model.model } : null);
  return save({ ...next, default_route });
}

export function deleteModel(ctx: Call, params: Record<string, unknown>): ModelCatalog {
  const current = catalog(ctx);
  requireRevision(current, params.expected_revision);
  const provider = typeof params.provider === "string" ? params.provider : "";
  const model = typeof params.model === "string" ? params.model : "";
  findModel(current, provider, model);
  const models = current.models.filter((item) => !(item.provider === provider && item.model === model));
  const next = { ...current, models };
  let default_route = current.default_route;
  if (default_route?.provider === provider && default_route.model === model) {
    default_route = replacement(current, params.replacement) ?? fallbackRoute(next);
    if (default_route?.provider === provider && default_route.model === model) default_route = fallbackRoute(next);
  }
  return save({ ...next, default_route });
}

export function setDefault(ctx: Call, params: Record<string, unknown>): ModelCatalog {
  const current = catalog(ctx);
  requireRevision(current, params.expected_revision);
  const route = replacement(current, params.route);
  if (route === null) throw new CallError(-32602, "a default route is required");
  return save({ ...current, default_route: route });
}

export function keyFor(provider: ProviderProfile): string {
  return readProviderKey(settings.store, provider);
}
