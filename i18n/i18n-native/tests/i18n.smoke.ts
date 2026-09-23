/// The store, driven without a kernel: a capability table that names a
/// well-behaved contributor, one that answers nothing readable, and one that
/// answers a language it never declared, plus the lookups the plugin answers
/// once it has folded them in.

import assert from "node:assert/strict";

import { BUILTIN_LANGUAGES, SYSTEM_PREFERENCE, type Language } from "@maota/i18n-protocol";
import type { Call, Channel, Route, Wiring } from "@maota/plugin-kit";

import { collectContributions, providerCapabilities } from "../src/engine.ts";
import { definition } from "../src/plugin.ts";

interface Stub {
  channel: Channel;
  logs: string[];
  calls: string[];
}

/// A channel that answers from a table rather than a process. `call` is typed
/// to return `unknown` at this boundary anyway, so a table of replies is the
/// same shape the real one has.
function stubChannel(replies: Record<string, Record<string, unknown>>): Stub {
  const logs: string[] = [];
  const calls: string[] = [];
  const channel = {
    log(level: string, message: string) {
      logs.push(`${level}: ${message}`);
    },
    async call(capability: string, method: string) {
      calls.push(`${capability}/${method}`);
      const table = replies[capability];
      if (table === undefined) throw new Error(`${capability} is not mounted`);
      return table[method];
    },
    async subscribe() {
      return 1;
    },
  };
  return { channel: channel as unknown as Channel, logs, calls };
}

function route(provides: string[]): Route {
  return { plugin: "stub", provides } as unknown as Route;
}

function wiring(stub: Stub, config: Record<string, unknown>, capabilities: Record<string, Route>): Wiring {
  return { channel: stub.channel, config, capabilities };
}

function call(stub: Stub): Call {
  return {
    channel: stub.channel,
    config: {},
    capabilities: {},
    capability: "i18n",
    method: "catalog",
    caller: "test",
    signal: new AbortController().signal,
    stream: undefined,
  } as unknown as Call;
}

const table = {
  "i18n.web": {
    describe: { locales: ["zh-CN", "en"] },
    catalog: {
      messages: {
        "zh-CN": { newChat: "\u65b0\u5bf9\u8bdd" },
        en: { newChat: "New chat" },
      },
    },
  },
  "i18n.common": {
    describe: { locales: ["zh-CN", "en"] },
    catalog: { messages: { "zh-CN": { brand: "MaoTa" }, en: { brand: "MaoTa" } } },
  },
  "i18n.broken": { describe: { locales: [] } },
  "i18n.loose": {
    describe: { locales: ["en"] },
    catalog: { messages: { en: { hi: "Hi" }, "zh-CN": { hi: "\u55e8" } } },
  },
  "i18n.silent": { describe: { locales: ["en"] } },
};

const capabilities: Record<string, Route> = {
  hooks: route(["hook"]),
  "i18n.web": route(["i18n.web"]),
  "i18n.common": route(["i18n.common"]),
  "i18n.broken": route(["i18n.broken"]),
  "i18n.loose": route(["i18n.loose"]),
  "i18n.silent": route(["i18n.silent"]),
};

assert.deepEqual(providerCapabilities(capabilities), [
  "i18n.broken",
  "i18n.common",
  "i18n.loose",
  "i18n.silent",
  "i18n.web",
]);

const found = await collectContributions(stubChannel(table).channel, capabilities, new AbortController().signal);
/// `hooks` is not a contributor, `broken` declared no language, `silent` had
/// nothing to answer, and `loose` answered a language it never declared, which
/// is dropped rather than kept.
assert.deepEqual(
  found.map((contribution) => contribution.namespace),
  ["common", "loose", "web"],
);
assert.deepEqual(found.find((contribution) => contribution.namespace === "web")?.messages["en"], {
  newChat: "New chat",
});
assert.deepEqual(found.find((contribution) => contribution.namespace === "loose")?.messages, { en: { hi: "Hi" } });

const warned = stubChannel(table);
await collectContributions(warned.channel, capabilities, new AbortController().signal);
assert.deepEqual(warned.logs.filter((line) => line.startsWith("warn")), [
  "warn: i18n.broken has no usable describe; skipped",
  "warn: i18n.loose answered zh-CN, which it never declared",
  "warn: i18n.silent answered no readable words; skipped",
]);
assert.deepEqual(warned.calls.filter((entry) => entry.endsWith("/describe")).length, 5);

const missing = stubChannel({ ...table, "i18n.web": { describe: { locales: ["en"] } } });
await collectContributions(missing.channel, capabilities, new AbortController().signal);
assert.equal(missing.logs.includes("warn: i18n.web answered no readable words; skipped"), true);

assert.deepEqual(providerCapabilities({}), []);
assert.deepEqual(await definition.selfCheck?.(), []);

const running = stubChannel(table);
const live = wiring(running, { locale: "zh-CN" }, capabilities);
await definition.setup?.(live);
await definition.start?.(live);

const advertised = definition.methods["catalog"]!({}, call(running)) as {
  locale: string;
  languages: readonly Language[];
  namespaces: string[];
  catalog: Record<string, Record<string, Record<string, string>>>;
  problems: string[];
};
assert.equal(advertised.locale, "zh-CN");
assert.deepEqual(advertised.languages, BUILTIN_LANGUAGES);
assert.deepEqual(advertised.namespaces, ["common", "loose", "web"]);
assert.equal(advertised.catalog["en"]?.["web"]?.["newChat"], "New chat");
assert.equal(advertised.catalog["zh-CN"]?.["web"]?.["newChat"], "\u65b0\u5bf9\u8bdd");
/// `loose` is written in one language only, which the catalog reports without
/// refusing to serve the rest of it.
assert.deepEqual(advertised.problems, ["loose is written in only one language"]);
assert.equal(running.logs.some((line) => line.startsWith("info: i18n: common, loose, web")), true);

const asked = definition.methods["translate"]!({ key: "newChat", namespace: "web" }, call(running)) as {
  locale: string;
  text: string;
};
assert.deepEqual(asked, { locale: "zh-CN", text: "\u65b0\u5bf9\u8bdd" });
assert.deepEqual(
  definition.methods["translate"]!({ key: "brand", namespace: "web" }, call(running)),
  { locale: "zh-CN", text: "MaoTa" },
);
assert.deepEqual(definition.methods["translate"]!({ key: "nobody" }, call(running)), {
  locale: "zh-CN",
  text: "nobody",
});
assert.deepEqual(
  definition.methods["translate"]!({ key: "newChat", namespace: "web", locale: "en" }, call(running)),
  { locale: "en", text: "New chat" },
);

/// A profile that named no preference falls back on what the machine says,
/// which must still land on a language it declared.
const defaulted = stubChannel(table);
const bare = wiring(defaulted, {}, capabilities);
await definition.setup?.(bare);
await definition.start?.(bare);
const byDefault = definition.methods["catalog"]!({}, call(defaulted)) as {
  locale: string;
  languages: readonly Language[];
};
assert.deepEqual(byDefault.languages, BUILTIN_LANGUAGES);
assert.equal(
  BUILTIN_LANGUAGES.some((language) => language.id === byDefault.locale),
  true,
);

const custom = stubChannel(table);
const declared: readonly Language[] = [
  { id: "zh-CN", label: "\u7b80\u4f53\u4e2d\u6587", fallback: "en" },
  { id: "en", label: "English", fallback: null },
];
await definition.setup?.(wiring(custom, { locale: SYSTEM_PREFERENCE, languages: declared }, capabilities));
await definition.start?.(wiring(custom, { locale: SYSTEM_PREFERENCE, languages: declared }, capabilities));
assert.deepEqual(
  (definition.methods["catalog"]!({}, call(custom)) as { languages: readonly Language[] }).languages,
  declared,
);

const refused = stubChannel(table);
const broken: Language[] = [{ id: "en", label: "English", fallback: "gone" }];
await definition.setup?.(wiring(refused, { languages: broken }, capabilities));
await definition.start?.(wiring(refused, { languages: broken }, capabilities));
assert.equal(refused.logs.some((line) => line.includes("falls back on gone, which is not declared")), true);

definition.close?.("test");

console.log("i18n ok: discovery, skips, catalog, translate, declared languages");
