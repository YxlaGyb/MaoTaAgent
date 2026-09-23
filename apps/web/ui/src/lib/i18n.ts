/// The interface's words, and which language to say them in.
///
/// The app's own copy lives in `locales/`, one file per language, because this
/// file has no business holding a sentence a person reads. Words a plugin
/// contributes arrive from the host, which asks every plugin and folds what
/// they answer into one catalog; this file holds that catalog and searches it
/// after its own copy, so a plugin fills a gap the app left but cannot change
/// what the app already says.
///
/// The language rule itself is not written here. `@maota/i18n-protocol` owns
/// it, so the app and the plugins that answer the host resolve "system" and a
/// half-specified tag the same way.

import { useCallback, useSyncExternalStore } from "react";

import {
  COMMON_NAMESPACE,
  format,
  localeChain,
  lookup,
  resolveLocale,
  SYSTEM_PREFERENCE,
  type Catalog,
  type Language,
  type MessageVars,
} from "@maota/i18n-protocol";

import { fallback as enFallback, locale as enLocale, messages as enMessages } from "../locales/en.ts";
import { fallback as zhFallback, locale as zhLocale, messages as zhMessages } from "../locales/zh-CN.ts";

/// The namespace this app's own words belong to. A plugin may supply words for
/// it too, which is how a plugin adds a sentence to the interface it is drawn
/// in.
const NAMESPACE = "web";

const KEY = "maota.lang";

interface Dictionary {
  locale: string;
  fallback: string | null;
  messages: Record<string, string>;
}

/// The languages the app can say anything in: exactly the dictionaries it
/// ships. Adding a language is adding a file to this table, which is what keeps
/// a language from being offered before it can answer a single key.
const DICTS: readonly Dictionary[] = [
  { locale: zhLocale, fallback: zhFallback, messages: zhMessages },
  { locale: enLocale, fallback: enFallback, messages: enMessages },
];

const DICT: Record<string, Record<string, string>> = Object.fromEntries(
  DICTS.map((dictionary) => [dictionary.locale, dictionary.messages]),
);

function labelOf(dictionary: Dictionary): string {
  return dictionary.messages["langName"] ?? dictionary.locale;
}

/// The languages the app answers in, in the order a settings control offers
/// them.
export const LANGUAGES: readonly Language[] = DICTS.map((dictionary) => ({
  id: dictionary.locale,
  label: labelOf(dictionary),
  fallback: dictionary.fallback,
}));

export const LANGS: readonly { value: string; label: string }[] = DICTS.map((dictionary) => ({
  value: dictionary.locale,
  label: labelOf(dictionary),
}));

/// Every key the interface has, as the dictionaries define them. Asking for a
/// key no dictionary carries is a compile error at the call site rather than a
/// word replaced by its own name at runtime.
export type MessageKey = keyof typeof zhMessages;

/// The host's catalog: nothing until the app has asked for it, because no
/// plugin's words are needed to draw the first frame.
let remote: Catalog = {};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === SYSTEM_PREFERENCE || (raw !== null && DICT[raw] !== undefined) ? raw : SYSTEM_PREFERENCE;
  } catch {
    return SYSTEM_PREFERENCE;
  }
}

function spoken(): string {
  return typeof navigator === "undefined" ? "" : navigator.language;
}

let preference = read();
let lang = resolveLocale(preference, LANGUAGES, spoken());

export function getLang(): string {
  return lang;
}

export function getLangPref(): string {
  return preference;
}

export function setLang(next: string): void {
  if (next !== SYSTEM_PREFERENCE && DICT[next] === undefined) return;
  preference = next;
  lang = resolveLocale(next, LANGUAGES, spoken());
  try {
    localStorage.setItem(KEY, next);
  } catch {
  }
  document.documentElement.lang = lang;
  for (const listener of listeners) listener();
}

/// Take the catalog the host built from what every plugin answered. A language
/// the app does not answer in is dropped and a malformed namespace is skipped,
/// but the reply itself is never merged field by field: half of somebody else's
/// vocabulary is worse than none of it.
export function adoptCatalog(reply: unknown): void {
  const catalog = (reply as { catalog?: unknown } | null)?.catalog;
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) return;
  const kept: Catalog = {};
  for (const language of LANGUAGES) {
    const namespaces = (catalog as Catalog)[language.id];
    if (namespaces === null || typeof namespaces !== "object" || Array.isArray(namespaces)) continue;
    const byNamespace: Record<string, Record<string, string>> = {};
    for (const [namespace, words] of Object.entries(namespaces)) {
      if (words === null || typeof words !== "object" || Array.isArray(words)) continue;
      const strings: Record<string, string> = {};
      for (const [key, text] of Object.entries(words as Record<string, unknown>)) {
        if (typeof text === "string") strings[key] = text;
      }
      byNamespace[namespace] = strings;
    }
    kept[language.id] = byNamespace;
  }
  remote = kept;
  for (const listener of listeners) listener();
}

/// The word for a key, in the language asked for. The app's own dictionaries
/// answer first, walking the language's fallback chain; a plugin's words answer
/// only where the app left a gap, and the key itself is the last resort so a
/// missing word is visible rather than silently blank.
export function tr(lang: string, key: MessageKey, vars?: MessageVars): string {
  for (const id of localeChain(LANGUAGES, lang)) {
    const text = DICT[id]?.[key];
    if (text !== undefined) return format(text, vars);
  }
  for (const namespace of [NAMESPACE, COMMON_NAMESPACE]) {
    const text = lookup(remote, LANGUAGES, lang, namespace, key);
    if (text !== key) return format(text, vars);
  }
  return key;
}

export function useLang(): string {
  return useSyncExternalStore(subscribe, getLang);
}

export function useLangPref(): string {
  return useSyncExternalStore(subscribe, getLangPref);
}

export function useT(): (key: MessageKey, vars?: MessageVars) => string {
  const lang = useLang();
  return useCallback((key: MessageKey, vars?: MessageVars) => tr(lang, key, vars), [lang]);
}
