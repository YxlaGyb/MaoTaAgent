---
name: doc-pairs
description: MaoTa project only: write or edit MaoTa documentation, the English, Chinese and record file trio, the switcher line, the README kinds, and the prose rules the checker enforces.
when-to-use: When the working directory is a MaoTa checkout and the user edits anything under docs/ or a README, or when the documentation checker fails on a language pair.
---

# Documentation in pairs (MaoTa)

This skill is about the MaoTa repository and its documentation pipeline. A
project with its own bilingual convention follows its own rules, not these.

Every document here exists three times in one directory: `x.md` in English,
`x.zh.md` in Chinese, and `x.i18n.yaml` recording the git blob hash of each
side. A pair merges whole; a half-updated pair fails the check.

## The switcher line

Directly under the `H1`, in both files, copy the line from a neighbouring pair
instead of retyping it:

```
English | [中文](README.zh.md)
```

The checker enforces the exact wording, so an approximation is a failure.

## Recording a change

Edit either side, bring the other along in the same change, then run:

```
pnpm i18n:write <x.md>
```

That rewrites the hashes in `x.i18n.yaml`. `pnpm check` runs `docs/i18n.check.ts`
without `--write` and fails on a stale record.

## README shape

`packages/<group>/README.md` is a `package-group` map of the packages in that
group; `packages/<group>/<pkg>/README.md` is the `package-reference` that owns
one contract. Front matter carries `description` and `kind`.

A package reference keeps the shape its kind names: a Summary of at most 100
words, a table of contents with an anchor on every linked section, `Use this
package`, `Understand the implementation`, `Further exploration` when sibling
docs exist. There is no limitations section: what a reader must know about a
boundary belongs in `Use this package` or `Understand the implementation` as a
plain statement of fact, and work that is genuinely not done belongs in a
`Dev Note` as an open question, or nowhere at all. A `Dev Note` section only
exists when there is a real open question, and is left out rather than filled
with a placeholder.

## Prose

Never use an em dash or an en dash: use a colon, a comma, parentheses, or a
sentence boundary. Do not use emoji or decorative icons; write Yes, No,
Supported, Unsupported, or a real word. Keep the Chinese side's section titles
matching the conventional names the existing pairs already use rather than
translating them again.
