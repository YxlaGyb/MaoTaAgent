---
description: "The store of the interface's words: it asks every plugin that owns a namespace, folds their answers into one catalog, and answers the lookups."
kind: "package-reference"
---

# i18n-native

English | [中文](README.zh.md)

## Summary

The plugin that keeps the interface's words. It provides the `i18n` capability and looks for every other plugin that provides an `i18n.<namespace>` capability, asks each of them which languages it writes and then for its words, and folds the answers into one catalog. Nothing is registered or unregistered: the capability table is the only registry there is, so a plugin that owns words may be mounted or dropped at any time and the store finds it out the same way. It does not manage the front ends that read it. A front end asks for the catalog once and holds its own copy, because a person typing has to see a word now rather than when a round trip finishes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

Reach it through the `i18n` capability.

| Method | Params | Returns |
|---|---|---|
| `catalog` | none | `{ locale, languages, namespaces, catalog, problems }`, everything a front end needs to answer a lookup itself. |
| `translate` | `{ key, namespace?, locale? }` | `{ locale, text }`, the same lookup for something already on this side of the wire, such as a message the host itself writes. |

| Reply field | Meaning |
|---|---|
| `locale` | The language everything should be rendered in, the profile's preference resolved against the declared languages and what the machine says. |
| `languages` | The declared languages, so a front end can offer them without holding a second copy of the table. |
| `namespaces` | The namespaces that answered, sorted. |
| `catalog` | The folded words, one `Messages` per language per namespace. |
| `problems` | What the fold and the parity check found, so a front end may show or log it. |

`translate` answers the word as written and does not substitute anything: a caller that has values to fill in formats them itself, which keeps one identifier out of the wire format.

### Config

| Key | Default | Meaning |
|---|---|---|
| `locale` | `"system"` | The language to render in. `system` asks the machine; anything else is matched against the declared languages. |
| `languages` | the builtin pair | The languages this deployment declares, each `{ id, label, fallback }`. A list of the wrong shape is ignored whole rather than partly read. |

### The provider contract

A plugin contributes by providing an `i18n.<namespace>` capability and answering two methods.

| Method | Answer |
|---|---|
| `describe` | `{ locales }`, the languages it has words for. |
| `catalog` | `{ namespace, messages }`, one `Messages` per locale. |

A contributor is asked about each language it declared, and its answers are read against that list. A declared language it answered nothing for, or a language it answered that it never declared, is a warning and the rest of its words are still used.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/engine.ts`](src/engine.ts) | Finding the contributors: the capability prefix, the two calls, and the skips. |
| [`src/plugin.ts`](src/plugin.ts) | The `i18n` capability: its config, the fold, `catalog` and `translate`. |
| [`src/index.ts`](src/index.ts) | The entry a kernel spawns: it runs the definition. |

### Why discovery is a prefix and not a registry

The store never holds a list of contributors, because a list would be a second source of truth about what is mounted, and it would go stale exactly when a plugin is mounted or dropped. Instead the capability table itself is the registry: `providerCapabilities` filters the table by the `i18n.` prefix, so a plugin contributes by being mounted and stops contributing by being dropped, with nothing to register or unregister. The store re-reads the table on `kernel.capabilities.changed`, because the snapshot it was handed at start is a moment and not a fact. This is the same shape `hooks-native` uses for its providers, which is deliberate: the two stores answer the same question about their own extension points.

### Why a bad contributor is skipped and not fatal

A contributor that cannot be described, answers no readable words, or answers something malformed is skipped with a warning. The alternative was to refuse to start, and the comparison decides it: an interface missing one namespace shows a key where a sentence belonged, which a person can see and report, while an interface that refused to start because one plugin's words were malformed cannot be used at all. The same reasoning applies field by field inside a contributor: a language it declared but cannot answer is dropped, and the languages it did answer are kept.

### Why the whole catalog crosses the wire

The store hands over the entire catalog rather than answering one lookup at a time, because rendering has to be synchronous. A front end that asked the store per key would show a key, wait, and then show the sentence, which is what the fold exists to avoid; so the front end keeps its own copy. That also decides what the store is not: it is not the component that decides which language is in effect, because the front end resolves that itself from the same language list, and a preference can change without anything being asked of this process.

### Three facts bound this store

The languages are read once at start and a profile that declared a list of the wrong shape gets the builtin pair, because the config is a durable boundary and a table that cannot be read is not a table to half apply. The catalog is rebuilt whole whenever a capability changes, so a contributor's mistake is corrected by the next discovery rather than being patched. And nothing here outlives the process: the abort controller exists only so a discovery still in flight when the kernel says goodbye stops with it.

-----

<a id="further-exploration"></a>
## Further exploration

- [i18n-protocol](../i18n-protocol/README.md): the languages, the fold and the readers this store is written over.
- [hooks-native](../../packages/hooks/hooks-native/README.md): the sibling store that discovers its providers the same way.
- [plugin-kit](../../packages/plugin-kit/README.md): the `Definition`, `Channel` and `Route` shapes this plugin is written in.
