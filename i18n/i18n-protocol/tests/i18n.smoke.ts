/// The rules, exercised without a process: which capability owns words, which
/// language a preference means, how a chain is walked, which contributions are
/// refused, and what a lookup answers when nobody has the key.

import assert from "node:assert/strict";

import {
  BUILTIN_LANGUAGES,
  COMMON_NAMESPACE,
  I18N_CAPABILITY_PREFIX,
  SYSTEM_PREFERENCE,
  buildCatalog,
  capabilityOf,
  defineMessages,
  emptyCatalog,
  format,
  isI18nCapability,
  isLanguageId,
  languageProblems,
  localeChain,
  lookup,
  namespaceKeys,
  namespaceOf,
  parityProblems,
  readI18nDescription,
  readI18nWords,
  resolveLocale,
  type I18nContribution,
  type Language,
} from "../src/index.ts";

const languages = BUILTIN_LANGUAGES;

assert.equal(isI18nCapability("i18n.web"), true);
assert.equal(isI18nCapability("i18n."), false);
assert.equal(isI18nCapability("hooks"), false);
assert.equal(namespaceOf("i18n.web"), "web");
assert.equal(capabilityOf("web"), "i18n.web");
assert.equal(capabilityOf(capabilityOf("web")), "i18n.web");
assert.equal(capabilityOf(namespaceOf(I18N_CAPABILITY_PREFIX + "common")), "i18n.common");

assert.equal(isLanguageId("zh-CN"), true);
assert.equal(isLanguageId("zh-Hans-CN"), true);
assert.equal(isLanguageId("zh_CN"), false);
assert.equal(isLanguageId(""), false);
assert.equal(isLanguageId(7), false);

assert.deepEqual(languageProblems(languages), []);
assert.deepEqual(
  languageProblems([
    { id: "en", label: "English", fallback: "en" },
  ]).length,
  1,
);
assert.equal(
  languageProblems([
    { id: "zh-CN", label: "\u7b80\u4f53\u4e2d\u6587", fallback: "ja" },
    { id: "en", label: "English", fallback: null },
  ]).length,
  1,
);
assert.equal(
  languageProblems([
    { id: "EN", label: "English", fallback: null },
    { id: "en", label: "english", fallback: null },
  ]).length,
  1,
);
assert.equal(
  languageProblems([
    { id: "zh-CN", label: " ", fallback: "en" },
    { id: "en", label: "English", fallback: null },
  ]).length,
  1,
);

/// A chain that repeats is reported once, and a chain of three languages is
/// walked to its end rather than cut off at the second step.
assert.equal(
  languageProblems([
    { id: "aa", label: "A", fallback: "bb" },
    { id: "bb", label: "B", fallback: "cc" },
    { id: "cc", label: "C", fallback: null },
  ]).length,
  0,
);
assert.equal(
  languageProblems([
    { id: "aa", label: "A", fallback: "bb" },
    { id: "bb", label: "B", fallback: "cc" },
    { id: "cc", label: "C", fallback: "aa" },
  ]).length,
  3,
);
assert.equal(
  languageProblems([
    { id: "aa", label: "A", fallback: "bb" },
    { id: "bb", label: "B", fallback: "zz" },
    { id: "cc", label: "C", fallback: null },
  ]).length,
  2,
);

assert.equal(resolveLocale("zh-CN", languages, "en-US"), "zh-CN");
assert.equal(resolveLocale(SYSTEM_PREFERENCE, languages, "zh-Hans-CN"), "zh-CN");
assert.equal(resolveLocale(SYSTEM_PREFERENCE, languages, "zh"), "zh-CN");
assert.equal(resolveLocale(SYSTEM_PREFERENCE, languages, "fr-FR"), "en");
assert.equal(resolveLocale(SYSTEM_PREFERENCE, languages, ""), "en");
assert.equal(resolveLocale("kl-GL", languages, "en-US"), "en");
assert.equal(resolveLocale(null, languages, "ZH-cn"), "zh-CN");
assert.equal(resolveLocale(undefined, languages, ""), "en");

assert.deepEqual(localeChain(languages, "zh-CN"), ["zh-CN", "en"]);
assert.deepEqual(localeChain(languages, "en"), ["en"]);
assert.deepEqual(
  localeChain(
    [
      { id: "aa", label: "A", fallback: "bb" },
      { id: "bb", label: "B", fallback: "aa" },
    ],
    "aa",
  ),
  ["aa", "bb"],
);
assert.deepEqual(localeChain(languages, "gone"), ["gone"]);

assert.equal(format("plain"), "plain");
assert.equal(format("plain", {}), "plain");
assert.equal(format("step {n} of {total}", { n: 2, total: 5 }), "step 2 of 5");
assert.equal(format("step {n} of {total}", { n: 2 }), "step 2 of {total}");
assert.equal(format("{a}{a}", { a: "x" }), "xx");

const words = defineMessages({ hello: "Hello" });
assert.deepEqual(words, { hello: "Hello" });

assert.deepEqual(readI18nDescription({ locales: ["en"] }), { locales: ["en"] });
assert.deepEqual(readI18nDescription({ locales: ["en", "en"] }), { locales: ["en"] });
assert.equal(readI18nDescription({ locales: [] }), null);
assert.equal(readI18nDescription({ locales: ["en", "zh_CN"] }), null);
/// The namespace is not declared here: it is the capability name, so a
/// contributor that writes one anyway is not refused, only ignored.
assert.deepEqual(readI18nDescription({ namespace: "web", locales: ["en"] }), { locales: ["en"] });
assert.equal(readI18nDescription(null), null);
assert.equal(readI18nDescription([1]), null);

assert.deepEqual(readI18nWords({ messages: { en: { a: "A" } } }), { en: { a: "A" } });
assert.deepEqual(readI18nWords({ messages: { "zh-CN": { a: "\u7532" }, en: { a: "A" } } }), {
  "zh-CN": { a: "\u7532" },
  en: { a: "A" },
});
assert.equal(readI18nWords({}), null);
assert.equal(readI18nWords({ messages: {} }), null);
assert.equal(readI18nWords({ messages: { en: {} } }), null);
assert.equal(readI18nWords({ messages: { "zh_CN": { a: "A" } } }), null);
assert.equal(readI18nWords({ messages: { en: { a: 1 } } }), null);
assert.equal(readI18nWords({ messages: ["en"] }), null);

assert.deepEqual(emptyCatalog(languages), { "zh-CN": {}, en: {} });
assert.deepEqual(emptyCatalog([{ id: "en", label: "English", fallback: null }]), { en: {} });

const web: I18nContribution = {
  namespace: "web",
  messages: { "zh-CN": { newChat: "\u65b0\u5bf9\u8bdd" }, en: { newChat: "New chat" } },
};
const shared: I18nContribution = { namespace: COMMON_NAMESPACE, messages: { en: { brand: "MaoTa" } } };
const built = buildCatalog(languages, [web, shared]);
assert.deepEqual(built.problems, []);
assert.equal(built.catalog["en"]?.["web"]?.["newChat"], "New chat");
assert.equal(built.catalog["zh-CN"]?.["web"]?.["newChat"], "\u65b0\u5bf9\u8bdd");
assert.equal(built.catalog["zh-CN"]?.["common"], undefined);

const twice = buildCatalog(languages, [web, { namespace: "web", messages: { en: { other: "x" } } }]);
assert.equal(twice.problems.length, 1);
assert.equal(twice.catalog["en"]?.["web"]?.["other"], undefined);

const undeclared = buildCatalog(languages, [{ namespace: "web", messages: { ja: { a: "A" } } }]);
assert.equal(undeclared.problems.length, 1);
assert.equal(undeclared.catalog["ja"], undefined);

assert.equal(built.catalog["zh-CN"]?.["common"], undefined);
assert.equal(lookup(built.catalog, languages, "en", "web", "newChat"), "New chat");
assert.equal(lookup(built.catalog, languages, "zh-CN", "web", "newChat"), "\u65b0\u5bf9\u8bdd");
/// A key only English has is reached from Chinese through the fallback chain,
/// which is the whole point of declaring one.
assert.equal(lookup(built.catalog, languages, "zh-CN", "common", "brand"), "MaoTa");
assert.equal(lookup(built.catalog, languages, "en", "web", "brand"), "MaoTa");
assert.equal(lookup(built.catalog, languages, "en", "web", "nobody"), "nobody");
assert.equal(lookup(built.catalog, languages, "gone", "web", "newChat"), "newChat");
assert.equal(lookup(emptyCatalog(languages), languages, "en", "web", "newChat"), "newChat");

assert.deepEqual(namespaceKeys(web), { "zh-CN": ["newChat"], en: ["newChat"] });
assert.deepEqual(namespaceKeys({ namespace: "web", messages: { en: { b: "B", a: "A" } } }), { en: ["a", "b"] });

assert.deepEqual(parityProblems([web]), []);
assert.deepEqual(parityProblems([shared]), ["common is written in only one language"]);
assert.deepEqual(parityProblems([{ namespace: "web", messages: { en: { a: "A" } } }]), [
  "web is written in only one language",
]);
assert.equal(
  parityProblems([
    { namespace: "web", messages: { en: { a: "A", b: "B" }, "zh-CN": { a: "\u7532" } } },
  ]).length,
  1,
);
assert.equal(
  parityProblems([
    { namespace: "web", messages: { en: { a: "A" }, "zh-CN": { a: "\u7532", b: "\u4e59" } } },
  ]).length,
  1,
);

/// A language set with no English still answers, because a lookup must be total
/// and a table someone edited badly must not take the interface down.
const chineseOnly: readonly Language[] = [{ id: "zh-CN", label: "\u7b80\u4f53\u4e2d\u6587", fallback: null }];
assert.equal(resolveLocale(SYSTEM_PREFERENCE, chineseOnly, "fr-FR"), "zh-CN");
assert.deepEqual(localeChain(chineseOnly, "zh-CN"), ["zh-CN"]);

console.log("i18n protocol ok: capabilities, languages, chains, contributions, catalog, lookup, parity");
