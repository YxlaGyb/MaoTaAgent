#!/usr/bin/env node
import { CallError, isPluginEntry, runPlugin, type Definition } from "@maota/plugin-kit";
import { failureOf, isThinkingLevel, kindOfCode, readModelRequest, readRoute } from "@maota/model-protocol";
import {
  adapterDescriptors,
  catalog,
  configure,
  deleteModel,
  deleteProvider,
  discover,
  resolveModel,
  saveModel,
  saveProvider,
  setDefault,
  view,
} from "./catalog.ts";
import { completeModel, streamModel } from "./chat.ts";
import { DEFAULT_RETRY, policyFor, readRetry, type RetryTables } from "./retry.ts";

let retry: RetryTables = readRetry(undefined);

function selfCheck(): string[] {
  const problems: string[] = [];
  const tables = readRetry({ max_retries: 3, providers: { openai: { max_retries: 9 } } });
  if (policyFor(tables, "openai", "gpt").max_retries !== 9) problems.push("retry provider override is wrong");
  if (policyFor({ every: DEFAULT_RETRY, providers: new Map() }, "x", "y").max_retries !== DEFAULT_RETRY.max_retries) {
    problems.push("retry default is wrong");
  }
  const failure = failureOf(new CallError(-32051, "slow", { retry_after_ms: 2000 }));
  if (failure.kind !== "rate_limit" || failure.retry_after_ms !== 2000) problems.push("failure facts are wrong");
  if (kindOfCode(-32050) !== "auth") problems.push("auth code is wrong");
  return problems;
}

export const definition: Definition = {
  provides: ["model"],
  requires: [{ capability: "session", optional: true }],
  configKeys: ["file", "stream_idle_timeout_ms", "retry"],
  setup(wiring) {
    configure(wiring.config);
    retry = readRetry(wiring.config.retry);
  },
  methods: {
    async describe(_params, ctx) {
      return { adapters: await adapterDescriptors(ctx) };
    },
    list(_params, ctx) {
      return view(ctx);
    },
    async discover(params, ctx) {
      return await discover(ctx, params ?? {});
    },
    save_provider(params, ctx) {
      return saveProvider(ctx, params ?? {});
    },
    delete_provider(params, ctx) {
      return deleteProvider(ctx, params ?? {});
    },
    save_model(params, ctx) {
      return saveModel(ctx, params ?? {});
    },
    delete_model(params, ctx) {
      return deleteModel(ctx, params ?? {});
    },
    set_default(params, ctx) {
      return setDefault(ctx, params ?? {});
    },
    resolve(params, ctx) {
      const value = catalog(ctx);
      const route = params?.route === undefined || params.route === null ? undefined : readRoute(params.route);
      return resolveModel(value, {
        ...(route === undefined ? {} : { route }),
        ...(isThinkingLevel(params?.level) ? { level: params.level } : {}),
        ...(typeof params?.model === "string" && params.model !== "" ? { model: params.model } : {}),
        strict: params?.strict === true,
      });
    },
    async chat(params, ctx) {
      if (ctx.stream === undefined) throw new CallError(-32602, "model.chat is streaming");
      const request = readModelRequest(params);
      const value = catalog(ctx);
      const resolved = resolveModel(value, { route: request.route, strict: true });
      return await streamModel(ctx, { ...request, route: resolved.route }, resolved, retry);
    },
    async complete(params, ctx) {
      const request = readModelRequest(params);
      const value = catalog(ctx);
      const resolved = resolveModel(value, { route: request.route, strict: true });
      return await completeModel(ctx, { ...request, route: resolved.route }, resolved);
    },
  },
  async selfCheck() {
    return selfCheck();
  },
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);
