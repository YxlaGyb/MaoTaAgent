# Documentation Conventions

## Language pairs

- A document kept in both languages is a three-file pair in one directory: English `x.md`, Chinese `x.zh.md`, and a record `x.i18n.yaml` holding the git blob hash of each side.
- Both languages carry equal authority: write either one first, bring the other along in the same change, then re-record with `pnpm run i18n:write <x.md>`. Pairs merge whole.
- Each file carries a language switcher directly under its H1, naming both languages and linking the other side: the English file links `x.zh.md`, the Chinese file links `x.md`. `pnpm check` enforces the exact wording and the recorded hashes, so copy the line from an existing pair instead of retyping it.
- The Chinese half mirrors the same section order and titles, using the conventional Chinese names the existing pairs already use. Copy them from a neighbouring pair rather than inventing or re-translating them.
- Only a pair and its switcher line carry Chinese. Every other file in the repository is written in English.

## README kinds and shape

- A package README uses the kind its position implies: `packages/<group>/README.md` is a `package-group` map that never restates a package contract, while `packages/<group>/<pkg>/README.md` is a `package-reference` that owns it.
- YAML front matter carries `description` and `kind`.
- Keep the shape the kind names: a Summary of at most 100 words, a table of contents with an anchor on every linked section, `Use this package` with a table for each input the contract accepts, `Understand the implementation`, `Further exploration` when there are sibling docs to point at, and `Known Limitations and Deferred Work`.
- A `Dev Note` section is optional and exists only for a real open question; when there is none, leave the section out instead of writing a placeholder.

## Plain prose

- Keep documents plain: no collapsible blocks, no "click to expand" labels, no invented or decorative section names.

## Avoid Decorative Icons

 - Do not use emojis or icons (e.g., 🔒, ✅, ⚠️, 🟢) in the documentation; they render inconsistently across operating systems and fonts, which actually reduces readability.
 - Convey everything clearly through text:
 - Use specific terms for status or results: Yes/No, Supported/Unsupported, Completed/In Progress/Not Started, Normal/Abnormal, High/Medium/Low.
 - Use text in table status columns instead of symbols like ✅, ❌, 🟢, or 🔴; if a legend is required, use a text-based legend.
 - Use text labels for hints or warnings (e.g., "Note:", "Important:", "Implemented:") rather than emoji prefixes.
 - The following are acceptable (as they render consistently in monospaced fonts and serve a structural rather than decorative purpose): ASCII box-drawing characters (┌─┘├), geometric arrows (▲ ► ▼), circled numbers (① ② ③), plain-text arrows (→ ← ↓), and text-based keyboard shortcuts (e.g., Cmd+K).
 - Minimize the use of dashes or non-textual symbols to maintain a clean, tidy appearance.

## Avoid Em Dashes

 - Never use an em dash or an en dash in prose, in either language.
 - Use a colon to introduce an explanation, a comma or semicolon between clauses, and parentheses for an aside.
 - Hyphens in code, flags, file names, and compound words are unaffected.