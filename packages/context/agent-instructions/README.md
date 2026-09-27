---
description: "The agent-instructions hook: the AGENTS.md and CLAUDE.md files it loads, their byte budget, and the PreModel note it contributes."
kind: "package-reference"
---

# context-agent-instructions

English | [中文](README.zh.md)

## Summary

This plugin contributes workspace instructions without defining a tool. It declares `hook.agent-instructions` and answers `PreModel` with one context entry. The loader reads `$MAOTA_HOME/AGENTS.md`, then every `AGENTS.md` and `CLAUDE.md` from the Git root to the session working directory. Identical content is loaded once, more specific files come later, and the complete set is bounded by `max_bytes`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The hook

| Method | Answer |
|---|---|
| `describe` | `{ events: ["PreModel"] }` |
| `PreModel` | `{ context: [text] }`, or `null` when no instruction file exists. |

### Config

| Key | Default | Meaning |
|---|---|---|
| `max_bytes` | `65536` | The total UTF-8 byte budget. Broader files are dropped before the most specific file is truncated. |

The project root is the nearest ancestor holding `.git`. With no Git root, discovery stays in the session working directory. The provider does not read `.claude/rules`, expand imports, or discover nested files after startup.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The security scan runs before text reaches the hook result. A matching instruction file is replaced by a blocked notice instead of being injected. Read failures and missing files produce no block and are logged by the hook engine.

-----

<a id="further-exploration"></a>
## Further exploration

- [context group](../README.md): why this provider is a hook and not a registry entry.
- [hooks](../../hooks/README.md): the event and provider contract.