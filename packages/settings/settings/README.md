---
description: "Host-owned locale and theme preferences with revisioned, atomic JSON storage."
kind: "package-reference"
---

# settings

English | [中文](README.zh.md)

## Summary

`@maota/settings` owns the two user preferences the Web interface asks the Host to remember: locale and theme. It exposes `settings.get` and `settings.update`, validates every accepted value, refuses stale revisions with `-32060`, and writes the accepted document atomically to `$MAOTA_HOME/settings.json`. A successful change publishes `settings.changed`, so other clients can converge without polling.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### Config

| Key | Type | Default | Meaning |
|---|---|---|---|
| `file` | string | `$MAOTA_HOME/settings.json` | The settings document this plugin reads and writes. |

### Methods

| Method | Parameters | Answer |
|---|---|---|
| `get` | none | `{ revision, locale, theme }`. The current user preferences. A missing file reads as `{ revision: 0, locale: null, theme: null }`. |
| `update` | `{ patch, expected_revision? }` | The accepted view after a merge. `patch` accepts `locale` and `theme`; omitted fields keep their stored values. A stale revision is `-32060`, and an unknown or malformed field is `-32602`. Updating a field to its stored value returns the current view without a write or event. |

### Values

| Value | Accepted values | Meaning |
|---|---|---|
| `locale` | `null`, `system`, or a BCP 47-style id such as `en` or `zh-CN` | `null` delegates to the i18n profile or system locale. `system` explicitly selects the machine locale. |
| `theme` | `null`, `system`, `dark`, or `light` | `null` delegates to the Web default, which is `system`. |
| `revision` | Non-negative integer | The optimistic concurrency token returned by `get` and required when the caller wants stale-write protection. |

### Events

| Topic | Payload |
|---|---|
| `settings.changed` | The complete accepted `{ revision, locale, theme }` view. |

The event is best effort. A client that missed it can call `get` and compare revisions.

### The stored document

| Field | Meaning |
|---|---|
| `schema_version` | `1` for every document this version writes. |
| `revision` | Incremented by every accepted change. |
| `locale` | The explicit locale, or `null`. |
| `theme` | The explicit theme, or `null`. |

### Declarations

| Field | Value |
|---|---|
| `provides` | `settings` |
| `injects` | None |
| `registrations` | None |
| `hostCalls` | None |
| `configKeys` | `file` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The capability: patch validation, revision checks, events and `selfCheck`. |
| [`src/store.ts`](src/store.ts) | The document model: value readers, defaults, atomic writes and revision comparison. |

### Revisioned writes

`update` reads the current document, checks `expected_revision`, merges the accepted fields and writes the next revision only when something changed. The write goes to a temporary sibling file, is renamed into place and is chmodded to `0600`, so readers see either the previous document or the next one, never a partial file. The `settings.changed` event is published only after that rename.

### Reads and failures

A missing document produces the empty revision zero view. An unreadable or malformed document is refused with `-32603` instead of being replaced by defaults. Locale and theme values are validated at the durable boundary, so a malformed value cannot enter the JSON document.

-----

<a id="further-exploration"></a>
## Further exploration

- [i18n-native](../../../i18n/i18n-native/README.md): the consumer that reads `locale` and follows `settings.changed`.
- [web bridge](../../../apps/web/src/bridge.ts): the RPC surface that exposes these methods to the browser.
- [base bundle](../../bundle/base/README.md): the row list that mounts this capability.
