---
description: "The translation dialect: which languages exist, what a language's fallback chain is, how a plugin offers its words, and how every offer folds into one catalog."
kind: "package-reference"
---

# i18n-protocol

English | [中文](README.zh.md)

## Summary

The words a translation is written in, and the words a provider answers in. It holds one file and no dependency: the language table with each language's fallback, the rule that resolves a preference such as `system` against what a person's machine says, the `i18n.*` provider contract, the bound checks a contribution is read through, and the fold that turns every contribution into one catalog. It knows no plugin, no process and no interface, so a store, a plugin and an app may all import it without importing each other. The store, the plugin that answers the host, and the rendered text are three separate things.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Languages

| Export | Meaning |
|---|---|
| `Language` | `{ id, label, fallback }`. `label` is the language named in itself, and `fallback` is the language to look in when this one has no word for a key, or null when there is none. |
| `BUILTIN_LANGUAGES` | Simplified Chinese, falling back on English, and English falling back on nothing. A deployment that declares its own replaces this list. |
| `SYSTEM_PREFERENCE` | `"system"`, the preference that means "ask the machine". |
| `isLanguageId(value)` | Whether a string is shaped like a language id. |
| `languageOf(value)` | The language in a list that matches an id, comparing case-insensitively. |
| `languageProblems(languages)` | Every fault in a list: an id that is not shaped like one, two ids that differ only in case, an empty label, a fallback that names no language, and a fallback chain that loops. |

A language id is matched by `LANGUAGE_ID`, which accepts a primary subtag of two or three letters followed by any number of subtags, so `en`, `zh-CN` and `zh-Hans-CN` all pass.

### Resolving what a person asked for

| Function | Answer |
|---|---|
| `resolveLocale(preference, languages, spoken)` | The language to render in. `system`, an empty string, or a preference that names no language all fall back on what the machine says, compared by prefix, and then on the first language with no fallback of its own. |
| `localeChain(languages, locale)` | The order to look in: the language, then its fallback, then that one's fallback, and so on, each language appearing once. A language not in the list is its own chain, so a stale preference still renders something. |

### Messages

| Export | Meaning |
|---|---|
| `Messages` | `Record<string, string>`, one word or sentence per key. |
| `defineMessages<T>(messages)` | Declares a dictionary without losing its keys, so a caller can be told at compile time which keys exist. |
| `format(text, vars)` | Replaces `{name}` placeholders. A placeholder with no value is left as written, and every occurrence is replaced, not only the first. |
| `MessageVars` | The values `format` accepts: strings and numbers. |

### The provider contract

A plugin that has words to offer provides an `i18n.<name>` capability, where the namespace it writes in is that name after the prefix. `isI18nCapability(value)` and `namespaceOf(capability)` are the helpers around those names, and `I18N_CAPABILITY_PREFIX` is `"i18n."`.

| Method | Params | Answer |
|---|---|---|
| `describe` | none | `I18nDescription`: `{ locales }`, the languages this plugin has words for. |
| `catalog` | none | `I18nContribution`: `{ namespace, messages }`, where `messages` is one `Messages` per locale. |

The description names no namespace, because the capability already is one: a plugin cannot advertise words under a name that is not its own. `readI18nDescription(value)` and `readI18nWords(value)` are the readers, and each returns null rather than a partly usable shape when the payload is not one.

### Folding contributions

| Export | Meaning |
|---|---|
| `Catalog` | `Record<locale, Record<namespace, Messages>>`: the one shape everything downstream reads. |
| `emptyCatalog()` | A catalog with nothing in it. |
| `buildCatalog(languages, contributions)` | `{ catalog, problems }`. A namespace contributed twice is reported and skipped, and a locale no language declares is reported and dropped. |
| `lookup(catalog, languages, locale, namespace, key)` | The word: the namespace along the language's fallback chain first, then `COMMON_NAMESPACE` along the same chain, then the key itself as written. |
| `COMMON_NAMESPACE` | `"common"`, the namespace every contributor may write into. |
| `namespaceKeys(contribution)` | `Record<locale, string[]>`: which keys one contribution's namespace carries in each language it writes, sorted. |
| `parityProblems(contributions)` | Every namespace written in only one language, and every key one language has that another does not, read as one contribution at a time. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Everything: the languages, the resolver, the messages, the contract, the fold. |

### Why the dialect is a leaf

An extension point belongs to the package that owns it, so a plugin that offers words names `i18n.<name>` and nothing about who consumes it, while a store that consumes them names the capability pattern and nothing about who writes words. This package is what makes that possible: it is the only place where `i18n.` or `common` is written down, and both sides may import it because it imports neither. It also means the resolver exists once: a half-specified tag such as `zh-Hans-CN` resolves the same way wherever it is asked, so the store and the app cannot disagree about what a preference means.

### Why the namespace comes from the capability

`I18nDescription` declares `locales` and deliberately not a namespace. If a plugin named its own namespace, that name could drift from the identity of the contributor, and two plugins could claim the same one without either being wrong. Deriving it from the capability means a plugin's identity and its address are the same fact, and a contribution is filed under exactly one name that no other plugin can also be filed under. A namespace contributed twice is therefore a fault worth reporting rather than a merge to resolve.

### What the boundary checks are for

A contribution crosses a process boundary, so a store cannot trust its shape: `readI18nDescription` and `readI18nWords` check it field by field and refuse it whole rather than in part, because a namespace that arrived half readable is worse than one that never arrived at all. `languageProblems` exists for the same reason at the other end, on a language list a deployment wrote by hand. Everything inside this repository is typed, so nothing here validates a value that a static interface already guarantees.

### Three facts bound this dialect

A word is a string, with no plural forms and no markup, so a language whose grammar needs either would be rendered as several keys. `format` substitutes and does nothing else, so a translator's text is never interpreted as a template. And a catalog is built once from what the plugins answered at the time they were asked, so a plugin that adds a language later announces it the way any other provider announces a change.

-----

<a id="further-exploration"></a>
## Further exploration

- [i18n-native](../i18n-native/README.md): the store that calls these providers, folds their words and answers the host.
- [hook-protocol](../../packages/hooks/hook-protocol/README.md): the sibling dialect whose capability-prefix discovery this one follows.
