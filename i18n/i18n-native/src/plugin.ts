/// Where the interface's words are kept. Plugins own their own namespaces and
/// answer for them; this plugin holds the catalog they fold into and answers
/// every lookup, so no consumer has to know which plugin wrote a sentence, and
/// a plugin can be mounted or dropped without anything being re-registered.
///
/// It does not manage the front ends that read it. A front end asks for the
/// catalog and holds its own copy, because a person typing has to see a word
/// now rather than when a round trip finishes.

import {
  BUILTIN_LANGUAGES,
  SYSTEM_PREFERENCE,
  buildCatalog,
  emptyCatalog,
  format,
  languageProblems,
  lookup,
  parityProblems,
  resolveLocale,
  type Catalog,
  type Language,
} from "@maota/i18n-protocol";
import type { Channel, Definition, Route, Wiring } from "@maota/plugin-kit";

import { collectContributions } from "./engine.ts";

interface Settings {
  locale: string;
  languages: readonly Language[];
}

let settings: Settings = { locale: SYSTEM_PREFERENCE, languages: BUILTIN_LANGUAGES };
let catalog: Catalog = emptyCatalog(BUILTIN_LANGUAGES);
let namespaces: string[] = [];
let problems: string[] = [];
/// Nothing here outlives the process; the controller exists so a discovery call
/// still in flight when the kernel says goodbye stops with it.
const life = new AbortController();

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/// The languages a profile declares, or nothing when it declared a shape this
/// plugin cannot read. The table is a durable boundary, so it is checked rather
/// than trusted into the type a lookup walks.
function readLanguages(value: unknown): readonly Language[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const found: Language[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const fallback = entry.fallback;
    if (typeof entry.id !== "string" || entry.id.trim() === "") return null;
    if (typeof entry.label !== "string" || entry.label.trim() === "") return null;
    if (fallback !== null && fallback !== undefined && typeof fallback !== "string") return null;
    found.push({ id: entry.id, label: entry.label, fallback: fallback ?? null });
  }
  return found;
}

/// What the machine says it speaks, for a preference that named nothing. Every
/// front end sends the same thing when it asks, so this is only the headless
/// default.
function machineLocale(): string {
  for (const name of ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "";
  }
}

async function discover(channel: Channel, capabilities: Record<string, Route>): Promise<void> {
  const contributions = await collectContributions(channel, capabilities, life.signal);
  const built = buildCatalog(settings.languages, contributions);
  catalog = built.catalog;
  namespaces = contributions.map((contribution) => contribution.namespace).sort();
  problems = [...built.problems, ...parityProblems(contributions)];
  channel.log("info", `i18n: ${namespaces.join(", ") || "(none)"}`, {
    namespaces,
    locales: settings.languages.map((language) => language.id),
    problems: problems.length,
  });
  for (const problem of problems) channel.log("warn", `i18n: ${problem}`);
}

export const definition: Definition = {
  provides: ["i18n"],
  configKeys: ["locale", "languages"],

  setup(wiring) {
    settings = {
      languages: readLanguages(wiring.config.languages) ?? BUILTIN_LANGUAGES,
      locale:
        typeof wiring.config.locale === "string" && wiring.config.locale.trim() !== ""
          ? wiring.config.locale
          : SYSTEM_PREFERENCE,
    };
    catalog = emptyCatalog(settings.languages);
    namespaces = [];
    problems = [];
  },

  async start(wiring: Wiring) {
    const broken = languageProblems(settings.languages);
    for (const problem of broken) wiring.channel.log("warn", `i18n: ${problem}`);
    await discover(wiring.channel, { ...wiring.capabilities });
    // The table handed over at start is a snapshot, and a plugin that owns words
    // may be mounted or dropped later; the kernel publishes every change, so no
    // row order is load-bearing here.
    await wiring.channel.subscribe(["kernel.capabilities.changed"], (_topic, _seq, payload) => {
      const table = (payload as { capabilities?: Record<string, Route> } | null)?.capabilities;
      if (table === undefined || table === null) return;
      void discover(wiring.channel, table).catch(() => undefined);
    });
  },

  methods: {
    /// Everything a front end needs to answer a lookup itself, in one reply.
    /// Handing over the whole catalog is what keeps rendering synchronous: a
    /// word is never waited for.
    catalog() {
      return {
        locale: resolveLocale(settings.locale, settings.languages, machineLocale()),
        languages: settings.languages,
        namespaces,
        catalog,
        problems,
      };
    },

    /// The same lookup, asked by something already on this side of the wire,
    /// which is what a message the host itself writes uses.
    translate(params) {
      const locale = resolveLocale(text(params?.locale) || settings.locale, settings.languages, "");
      return {
        locale,
        text: lookup(
          catalog,
          settings.languages,
          locale,
          text(params?.namespace) || "common",
          text(params?.key),
        ),
      };
    },
  },

  close() {
    life.abort();
  },

  selfCheck() {
    const problems: string[] = [];
    const languages = BUILTIN_LANGUAGES;

    if (resolveLocale(SYSTEM_PREFERENCE, languages, "zh-Hans-CN") !== "zh-CN") {
      problems.push("a Chinese machine was not resolved to Chinese");
    }
    if (resolveLocale(SYSTEM_PREFERENCE, languages, "fr-FR") !== "en") {
      problems.push("an unknown language was not resolved to English");
    }
    if (resolveLocale("zh-CN", languages, "en-US") !== "zh-CN") {
      problems.push("a stated preference was overridden by the machine");
    }
    if (resolveLocale("kl-GL", languages, "en-US") !== "en") {
      problems.push("a preference nobody declared was not resolved to English");
    }

    const built = buildCatalog(languages, [
      { namespace: "web", messages: { "zh-CN": { hello: "你好", only: "独有" }, en: { hello: "Hello" } } },
      { namespace: "common", messages: { en: { brand: "MaoTa" } } },
    ]);
    if (built.problems.length !== 0) problems.push(`a plain contribution was refused: ${built.problems.join("; ")}`);
    if (lookup(built.catalog, languages, "zh-CN", "web", "hello") !== "你好") {
      problems.push("a word in the asked-for namespace was not found");
    }
    if (lookup(built.catalog, languages, "en", "web", "only") !== "only") {
      problems.push("a key nobody owns was not answered with itself");
    }
    if (lookup(built.catalog, languages, "zh-CN", "web", "brand") !== "MaoTa") {
      problems.push("the shared namespace was not searched after the asked-for one");
    }
    if (lookup(built.catalog, languages, "en", "web", "nowhere") !== "nowhere") {
      problems.push("a key nobody owns was not answered with itself");
    }
    if (parityProblems([{ namespace: "web", messages: { "zh-CN": { a: "甲" }, en: { a: "A", b: "B" } } }]).length !== 1) {
      problems.push("a namespace whose two sides disagree was not reported");
    }
    if (parityProblems([{ namespace: "web", messages: { "zh-CN": { a: "甲" }, en: { a: "A" } } }]).length !== 0) {
      problems.push("a namespace whose two sides agree was reported");
    }

    const doubled = buildCatalog(languages, [
      { namespace: "web", messages: { en: { a: "A" } } },
      { namespace: "web", messages: { en: { b: "B" } } },
    ]);
    if (doubled.problems.length !== 1) problems.push("a namespace contributed twice was not reported");
    const undeclared = buildCatalog(languages, [{ namespace: "web", messages: { ja: { a: "あ" } } }]);
    if (undeclared.problems.length !== 1) problems.push("a language nobody declared was kept");
    if (undeclared.catalog["en"]?.["web"] !== undefined) problems.push("an undeclared language reached the catalog");

    if (format("step {n} of {m}", { n: 2 }) !== "step 2 of {m}") {
      problems.push("a placeholder without a variable was blanked instead of kept");
    }
    if (languageProblems([{ id: "en", label: "English", fallback: "en" }]).length !== 1) {
      problems.push("a language falling back on itself was not reported");
    }
    if (languageProblems([{ id: "zh-CN", label: "简体中文", fallback: "en" }]).length !== 1) {
      problems.push("a fallback naming an undeclared language was not reported");
    }
    if (languageProblems(BUILTIN_LANGUAGES).length !== 0) {
      problems.push("the built-in languages were reported as broken");
    }
    return problems;
  },
};

