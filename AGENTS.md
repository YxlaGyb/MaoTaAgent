# AGENTS.md

MaoTaAgent is a fully plugin-based proxy framework; please read [@docs/architecture.md](docs\architecture.md) before making modifications.

## Repository layout

- `apps/cli/`: the `maota` launcher (`@virgena/maota`): entry modes, flags, terminal rendering. Its README owns the command contract.
- `apps/web/`: the web plugin: one HTTP server for both the UI and the host RPC. The UI is `apps/web/ui/`; the component library `MaoTaUI` is an out-of-tree link package.
- `packages/boot/config/`, `packages/boot/host/`: launch glue: which config file and kernel binary one launch uses, and the Node host that drives the kernel over stdio.
- `packages/<name>/src/main.ts`: one kernel plugin each (api, shell, tools, skill, skill-filesystem, session, agent). The kernel spawns them; they are never imported.
- `tests/`: repository-level smoke tests that need a real kernel binary.
- `docs/`: architecture, conventions, defensive patterns, and the bilingual-pair checker.
- `eggshell.toml` (tracked plugin set) and `eggshell.local.toml` (the machine layer, untracked).

## Commands

- `pnpm check`: types, bilingual pairs, plugin checks and the web typecheck. Run it before handing work over.
- `pnpm check:types`, `pnpm check:plugins`, `pnpm check:config`: the checks one at a time; `check:config` prints a config report without booting.
- `pnpm boot`, `pnpm boot "question"`, `pnpm web`: launch the CLI: interactive or one-shot, then the resident web mode.
- `pnpm cli:smoke`, `pnpm smoke`, `pnpm conversation`, `pnpm web:smoke`: smoke tests; the middle two need a built eggshell kernel.
- `pnpm i18n:write <x.md>`: re-record a bilingual pair after editing either side.

## Host sandbox failures

If a required gh, pnpm, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested sandbox-exec, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

## Conventions

 - Explicit is better than implicit; layered decoupling; composition over inheritance; no enforcement, but extension points are provided; there is no monolithic Trainer, but extension mechanisms such as hooks, FX, and distributed support are available.
 - Trust TypeScript at typed same-process boundaries. Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
 - No comments in code. Write one only where the logic is genuinely hard to follow, never to restate what the code already says.

## Defensive patterns

Read [@docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

- A document kept in both languages is a three-file pair in one directory: English `x.md`, Chinese `x.zh.md`, and a record `x.i18n.yaml` holding the git blob hash of each side. Both languages carry equal authority: write either one first, bring the other along in the same change, then re-record with `pnpm run i18n:write <x.md>`. Pairs merge whole.
- Each file carries a language switcher directly under its H1: `English | [中文](x.zh.md)` in the English file, `[English](x.md) | 中文` in the Chinese one. `pnpm check` enforces the switcher and the recorded hashes.
- A package README uses the kind its position implies: `packages/<group>/README.md` is a `package-group` map that never restates a package contract, while `packages/<group>/<pkg>/README.md` is a `package-reference` that owns it. YAML front matter carries `description` and `kind`.
- Keep the shape the kind names: a Summary of at most 100 words, a table of contents, anchors on linked sections, a table for every input the contract accepts, `Known Limitations and Deferred Work`, and a `Dev Note` inside `<details>`.
- Prose follows [docs/CONVENTIONS.md](docs/CONVENTIONS.md): no decorative emoji or icons, text in place of symbols, and minimal dashes.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives