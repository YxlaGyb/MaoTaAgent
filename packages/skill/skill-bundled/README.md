---
description: "The shipped-skill provider: the six skills inside its own directory, the lowest rank, and how a project replaces one."
kind: "package-reference"
---

# skill-bundled

English | [中文](README.zh.md)

## Summary

The skills a deployment ships. Six of them live under `skills/` in this package, one directory with one `SKILL.md` each, and the provider offers them at rank 600: below every local root, so a project that writes its own `code-review` replaces the shipped one instead of colliding with it. Three of the six describe this repository and say so in their descriptions, because the same words mean something else in a project with its own layout. The other three are ordinary engineering work with no project in them. It answers `list` and `load` and nothing else.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)

-----

<a id="use-this-package"></a>
## Use this package

### The six skills

| Name | About | Conditional |
|---|---|---|
| `skill-authoring` | MaoTa only: where a `SKILL.md` goes, which keys this build reads, what belongs in `references/` beside it. | No |
| `plugin-authoring` | MaoTa only: a package, its manifest, the plugin-kit definition, capability names and bundle rows. | Yes, `packages/**` |
| `doc-pairs` | MaoTa only: the English, Chinese and record trio, the switcher line, the prose the checker enforces. | No |
| `code-review` | Reviewing a change in any language or project: boundaries, error paths, cleanup, tests, what to report. | No |
| `debug-repro` | Diagnosing a failure in any language or project: reproduce, shrink, find the layer that lies, prove the fix. | No |
| `commit-and-pr` | Running a project's own checks, reading what is staged, writing the message, opening the review. | No |

The three project skills name the repository in their descriptions and again in the first paragraph of their bodies, which is what keeps them from being applied to a project that happens to use the same words. `plugin-authoring` declares `paths: ["packages/**"]`, so it only appears in the catalog once a session has touched something under `packages/`; it is also the live example of conditional activation.

### Configuration

None. This provider reads no config key and has no root to point anywhere else: its skills are the directories beside its own source.

### The two methods

| Method | Parameters | Answer |
|---|---|---|
| `list` | `{ cwd? }` | `{ candidates }`, one per shipped skill, all at rank 600 with `source` `bundled`. |
| `load` | `{ locator }` | `{ content }`: the body with the frontmatter removed. A locator without a path is refused with `-32602`. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider: where `skills/` is, `list`, `load` and `selfCheck`. |
| [`skills/`](skills/) | The six skills, each `<name>/SKILL.md`. |

### Why one package holds six skills

A provider can ship as many skills as it wants, and one package is one provider. Splitting these six into several packages would buy nothing: they share a rank, a lifecycle and a reason to exist, and the registry does not care how many candidates one provider offers. A second package earns its place when a set of skills is mounted by a different profile, or when its content grows enough to be released on its own.

### The rank

600 is below every local root, which is the whole point: a project replaces a shipped skill by writing one with the same name in `.agents/skills`, and the shipped text stays as the fallback. Nothing in this package knows which skills a project has.

### Adding a seventh

Add `skills/<kebab-name>/SKILL.md`, with frontmatter whose `name` equals the directory. `selfCheck` reads this directory the way the registry does, so a name that does not parse, an empty description, or a wrong rank fails `pnpm check:plugins` before a session ever runs.

The six are content rather than code: they are prose a model reads, so changing what one does is editing a document, and `selfCheck` can only check their shape. A deployment that wants one gone switches it off with the registry's `disable` rather than editing this package.

Three of the six say "MaoTa project only" in their description and in the first paragraph of their body. That is load-bearing: they describe this repository's own layout, and a different repository that mounts this provider should shadow them rather than expect them to adapt. The other three are general engineering skills and name no project at all.

-----

<a id="further-exploration"></a>
## Further exploration

- [skill](../skill/README.md): the dialect these files are written in, and the registry that serves them.
- [skill-filesystem](../skill-filesystem/README.md): the provider whose rank beats this one.
- [skills](../../../docs/user/skills.md): the frontmatter contract and the two levels, from the user's side.
