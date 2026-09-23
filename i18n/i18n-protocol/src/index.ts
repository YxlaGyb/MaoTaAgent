/// The words a localized interface is written in, and the words a plugin
/// answers in when it contributes some of them. Nothing here knows about a
/// process, a channel or a browser: it is the vocabulary both sides of a
/// translation share, plus the pure rules that turn contributions into a
/// catalog and a catalog into a sentence.
///
/// @module @maota/i18n-protocol

/// A plugin that owns translations provides an `i18n.<namespace>` capability
/// and implements `describe` and `catalog`. The capability table is the only
/// registry there is, which is what lets the store find contributors without
/// anybody registering one.
export const I18N_CAPABILITY_PREFIX = "i18n.";

/// The namespace every catalog is searched in after the one that was asked for,
/// so a word the whole product shares is written once.
export const COMMON_NAMESPACE = "common";

export function isI18nCapability(name: string): boolean {
  return name.startsWith(I18N_CAPABILITY_PREFIX) && name.length > I18N_CAPABILITY_PREFIX.length;
}

export function namespaceOf(capability: string): string {
  return isI18nCapability(capability) ? capability.slice(I18N_CAPABILITY_PREFIX.length) : capability;
}

export function capabilityOf(namespace: string): string {
  return isI18nCapability(namespace) ? namespace : `${I18N_CAPABILITY_PREFIX}${namespace}`;
}

/// A language the interface can be read in. `fallback` names the language to
/// look in when this one has no word for something, and the chain it forms must
/// end at a language that falls back on nothing, which is what makes a lookup
/// total.
export interface Language {
  id: string;
  label: string;
  fallback: string | null;
}

/// The languages the product ships: Chinese falls back on English, and English
/// falls back on nothing, so every chain terminates there.
export const BUILTIN_LANGUAGES: readonly Language[] = [
  { id: "zh-CN", label: "简体中文", fallback: "en" },
  { id: "en", label: "English", fallback: null },
];

/// The preference that means "whatever the machine is set to", kept apart from
/// a language id because it is not one.
export const SYSTEM_PREFERENCE = "system";

const LANGUAGE_ID = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function isLanguageId(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_ID.test(value);
}

export function languageOf(languages: readonly Language[], id: string): Language | undefined {
  return languages.find((language) => language.id === id);
}

/// Why a set of languages cannot be used: a fallback that names nothing, a
/// chain that never ends, or a cycle. A check runs this over the declared
/// languages, because a lookup that walks a broken chain would answer with a
/// key instead of a sentence.
export function languageProblems(languages: readonly Language[]): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  for (const language of languages) {
    if (!isLanguageId(language.id)) problems.push(`${JSON.stringify(language.id)} is not a language id`);
    const folded = language.id.toLowerCase();
    if (seenIds.has(folded)) problems.push(`${language.id} is declared twice`);
    seenIds.add(folded);
    if (language.label.trim() === "") problems.push(`${language.id} has no label`);
  }
  for (const language of languages) {
    let current: Language | undefined = language;
    const walked = new Set<string>([language.id]);
    for (;;) {
      const fallback: string | null = current?.fallback ?? null;
      if (fallback === null) break;
      if (walked.has(fallback)) {
        problems.push(`${language.id} falls back in a cycle through ${fallback}`);
        break;
      }
      walked.add(fallback);
      current = languageOf(languages, fallback);
      if (current === undefined) {
        problems.push(`${language.id} falls back on ${fallback}, which is not declared`);
        break;
      }
    }
  }
  return problems;
}

/// The language a preference means. A preference that names a declared language
/// is taken as it is; `system` and an id nobody declared are read as what the
/// machine says it speaks, and English is the last resort so a lookup always
/// has somewhere to go.
export function resolveLocale(
  preference: string | null | undefined,
  languages: readonly Language[],
  spoken = "",
): string {
  if (preference !== null && preference !== undefined && preference !== SYSTEM_PREFERENCE) {
    if (languageOf(languages, preference) !== undefined) return preference;
  }
  const wanted = spoken.trim().toLowerCase();
  if (wanted !== "") {
    const exact = languages.find((language) => language.id.toLowerCase() === wanted);
    if (exact !== undefined) return exact.id;
    const head = wanted.split("-")[0] ?? "";
    const byHead = languages.find((language) => language.id.toLowerCase().split("-")[0] === head);
    if (byHead !== undefined) return byHead.id;
  }
  return languageOf(languages, "en")?.id ?? languages[0]?.id ?? "en";
}

/// The languages to search for a word, in the order to search them: the one
/// that was asked for, then whatever it falls back on. A cycle is walked once
/// and no further, because a broken table must not turn into a hang.
export function localeChain(languages: readonly Language[], locale: string): string[] {
  const chain: string[] = [];
  let current: string | null = locale;
  while (current !== null && !chain.includes(current)) {
    chain.push(current);
    current = languageOf(languages, current)?.fallback ?? null;
  }
  return chain;
}

export type Messages = Record<string, string>;
export type MessageVars = Record<string, string | number>;

/// The words one side of a dictionary holds. It is an identity function with a
/// type on it: writing every dictionary through it is what lets one language be
/// the source of the key set and the others be checked against it.
export function defineMessages<T extends Messages>(messages: T): T {
  return messages;
}

/// Fill `{name}` placeholders from variables. A placeholder with no variable is
/// left as it was rather than blanked, so a missing value shows up in review
/// instead of reading as an omission.
export function format(text: string, vars?: MessageVars): string {
  if (vars === undefined) return text;
  let filled = text;
  for (const [name, value] of Object.entries(vars)) filled = filled.split(`{${name}}`).join(String(value));
  return filled;
}

/// What a contributor declares about itself: which languages it has words for.
/// The namespace is not declared here because the capability name already is
/// one, and a namespace written twice is a namespace that can drift.
export interface I18nDescription {
  locales: string[];
}

/// What a contributor answers its `catalog` call with, per language.
export interface I18nContribution {
  namespace: string;
  messages: Record<string, Messages>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readMessages(value: unknown): Messages | null {
  const record = asRecord(value);
  if (record === null) return null;
  const messages: Messages = {};
  for (const [key, text] of Object.entries(record)) {
    if (typeof text !== "string") return null;
    messages[key] = text;
  }
  return messages;
}

/// The languages a contributor says it has words for, or nothing. A capability
/// that cannot be read is not a contributor: the store skips it and says so,
/// the way the hook engine skips a hook it cannot describe.
export function readI18nDescription(value: unknown): I18nDescription | null {
  const record = asRecord(value);
  if (record === null) return null;
  const locales = record.locales;
  if (!Array.isArray(locales) || locales.length === 0) return null;
  const kept: string[] = [];
  for (const locale of locales) {
    if (typeof locale !== "string" || !isLanguageId(locale)) return null;
    if (!kept.includes(locale)) kept.push(locale);
  }
  return { locales: kept };
}

/// The words a contributor answers its `catalog` call with, per language, or
/// nothing. Half a contribution is worse than none: a namespace whose words
/// cannot be read would answer every key it owns with the key itself.
export function readI18nWords(value: unknown): Record<string, Messages> | null {
  const record = asRecord(value);
  if (record === null) return null;
  const raw = asRecord(record.messages);
  if (raw === null) return null;
  const messages: Record<string, Messages> = {};
  for (const [locale, words] of Object.entries(raw)) {
    if (!isLanguageId(locale)) return null;
    const read = readMessages(words);
    if (read === null || Object.keys(read).length === 0) return null;
    messages[locale] = read;
  }
  return Object.keys(messages).length === 0 ? null : messages;
}

/// Every word the interface can say, indexed the way a lookup asks for it.
export type Catalog = Record<string, Record<string, Messages>>;

export function emptyCatalog(languages: readonly Language[]): Catalog {
  const catalog: Catalog = {};
  for (const language of languages) catalog[language.id] = {};
  return catalog;
}

/// Fold contributions into one catalog. A namespace contributed twice is a
/// mistake worth stopping for, and a language nobody declared is dropped rather
/// than kept as a corner of the catalog nothing can reach.
export function buildCatalog(
  languages: readonly Language[],
  contributions: readonly I18nContribution[],
): { catalog: Catalog; problems: string[] } {
  const catalog = emptyCatalog(languages);
  const problems: string[] = [];
  const claimed = new Set<string>();
  for (const contribution of contributions) {
    if (claimed.has(contribution.namespace)) {
      problems.push(`${contribution.namespace} is contributed more than once`);
      continue;
    }
    claimed.add(contribution.namespace);
    for (const [locale, messages] of Object.entries(contribution.messages)) {
      const target = catalog[locale];
      if (target === undefined) {
        problems.push(`${contribution.namespace} is written in ${locale}, which no language declares`);
        continue;
      }
      target[contribution.namespace] = { ...(target[contribution.namespace] ?? {}), ...messages };
    }
  }
  return { catalog, problems };
}

/// The word for a key: the namespace that was asked for along its language
/// chain first, then the shared namespace along the same chain, and the key
/// itself when nobody has it. A key shown as itself is a visible gap rather
/// than a silent one.
export function lookup(
  catalog: Catalog,
  languages: readonly Language[],
  locale: string,
  namespace: string,
  key: string,
): string {
  const chain = localeChain(languages, locale);
  for (const id of chain) {
    const text = catalog[id]?.[namespace]?.[key];
    if (typeof text === "string") return text;
  }
  for (const id of chain) {
    const text = catalog[id]?.[COMMON_NAMESPACE]?.[key];
    if (typeof text === "string") return text;
  }
  return key;
}

/// Which languages a namespace is written in, and the keys each of them has.
/// This is what a parity check reads: a namespace must answer the same keys in
/// every language it claims, or a reader of one language meets keys while a
/// reader of the other meets sentences.
export function namespaceKeys(contribution: I18nContribution): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [locale, messages] of Object.entries(contribution.messages)) {
    found[locale] = Object.keys(messages).sort();
  }
  return found;
}

export function parityProblems(contributions: readonly I18nContribution[]): string[] {
  const problems: string[] = [];
  for (const contribution of contributions) {
    const perLanguage = namespaceKeys(contribution);
    const languagesWithWords = Object.keys(perLanguage);
    if (languagesWithWords.length < 2) {
      problems.push(`${contribution.namespace} is written in only one language`);
      continue;
    }
    const reference = languagesWithWords[0]!;
    const wanted = new Set(perLanguage[reference]!);
    for (const locale of languagesWithWords.slice(1)) {
      for (const key of wanted) {
        if (!perLanguage[locale]!.includes(key)) problems.push(`${contribution.namespace}/${key} is missing from ${locale}`);
      }
      for (const key of perLanguage[locale]!) {
        if (!wanted.has(key)) problems.push(`${contribution.namespace}/${key} is written in ${locale} but not in ${reference}`);
      }
    }
  }
  return problems;
}
