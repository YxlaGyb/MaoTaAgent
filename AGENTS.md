# AGENTS.md

MaoTaAgent is a fully plugin-based proxy framework; please read [@docs/architecture.md](docs/architecture.md) before making modifications.

## Repository layout

- `apps/cli/`: the `maota` launcher (`@virgena/maota`): entry modes, flags, terminal rendering. Its README owns the command contract.
- `apps/web/`: the web plugin: one HTTP server for both the UI and the host RPC. The UI is `apps/web/ui/`; the component library `MaoTaUI` is an out-of-tree link package.
- `packages/boot/config/`, `packages/boot/host/`: launch glue: which config file and kernel binary one launch uses, and the Node host that drives the kernel over stdio.
- `packages/<name>/src/main.ts`: one kernel plugin each (api, shell, tools, skill, skill-filesystem, session, agent). The kernel spawns them; they are never imported.
- `tests/`: repository-level smoke tests that need a real kernel binary.
- `docs/`: architecture, conventions, defensive patterns, and the bilingual-pair checker.
- `$MAOTA_HOME` (default `~/.maota`): the generated `eggshell.toml` plugin set and the untracked `eggshell.local.toml` machine layer. Nothing lives in the repository root.

## Commands

- `pnpm check`: types, bilingual pairs, plugin checks and the web typecheck. Run it before handing work over.
- `pnpm check:types`, `pnpm check:plugins`, `pnpm check:config`: the checks one at a time; `check:config` prints a config report without booting.
- `pnpm boot`, `pnpm boot "question"`, `pnpm web`: launch the CLI: interactive or one-shot, then the resident web mode.
- `pnpm cli:smoke`, `pnpm config:smoke`: CLI grammar and config resolution, no kernel needed.
- `pnpm smoke`, `pnpm conversation`, `pnpm hmr:smoke`, `pnpm web:smoke`: smoke tests that need a built eggshell kernel.
- `pnpm i18n:write <x.md>`: re-record a bilingual pair after editing either side.

## Host sandbox failures

If a required gh, pnpm, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested sandbox-exec, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

## Conventions

- Explicit is better than implicit; layered decoupling; composition over inheritance; no enforcement, but extension points are provided; there is no monolithic Trainer, but extension mechanisms such as hooks, FX, and distributed support are available.
- Trust TypeScript at typed same-process boundaries. Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- No comments in code. Write one only where the logic is genuinely hard to follow, never to restate what the code already says.

## Documentation

Read [@docs/CONVENTIONS.md](docs/CONVENTIONS.md) before writing or editing any document, README, or language pair; it owns the rules for pairs, README shape, and prose. `pnpm check` enforces the pairs it produces.

## Defensive patterns

Read [@docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Editing these instructions

`CLAUDE.md` only includes this file; edit `AGENTS.md`. Keep each rule self-contained while linking high-level docs, and condense when clarity survives.