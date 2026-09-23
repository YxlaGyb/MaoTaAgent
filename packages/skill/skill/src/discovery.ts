/// The discovery half of the skill registry: it finds the providers a
/// deployment wired up, reads what each of them offers, and decides which of
/// those skills this run activates. Every function here is a read of a
/// provider's answer against the paths the session has touched, so the run
/// state and the tool surface stay in `index.ts` and only the reading lives
/// here.

import { matchesAnyPath, toPosix, type Route } from "@maota/plugin-kit";
import {
  DEFAULT_CATALOG_MAX,
  DEFAULT_DESCRIPTION_MAX,
  isSkillName,
  readControl,
  type SkillCandidate,
  type SkillSummary,
} from "./protocol.ts";

const PREFIX = "skill.";

export const DEFAULTS = { catalog_description_max: DEFAULT_DESCRIPTION_MAX, catalog_max_chars: DEFAULT_CATALOG_MAX };

/// The registry finds its providers the way the tool dispatcher finds tools:
/// by capability name, once, from the table `start` hands over. That table is
/// the whole deployment rather than what has started so far, so no row order in
/// the bundle is load bearing.
export function discover(capabilities: Record<string, Route>): Array<[string, Route]> {
  return Object.entries(capabilities)
    .filter(([capability]) => capability.startsWith(PREFIX) && capability.length > PREFIX.length)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return out.length === value.length && out.length > 0 ? out : undefined;
}

/// A candidate crosses a process boundary, so every field is read rather than
/// trusted, and a field this build cannot read costs that one row rather than
/// being quietly dropped: a lost `paths` would activate a conditional skill.
export function readCandidate(raw: unknown): SkillCandidate | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const name = text(input.name);
  if (name === undefined || !isSkillName(name)) return null;
  if (typeof input.description !== "string") return null;
  const rank = input.rank;
  if (typeof rank !== "number" || !Number.isFinite(rank)) return null;
  const source = text(input.source);
  if (source === undefined) return null;
  const raw_policy = input.invocation as { modelInvocable?: unknown; userInvocable?: unknown } | undefined;
  if (raw_policy === undefined || typeof raw_policy !== "object" || raw_policy === null) return null;
  const { modelInvocable, userInvocable } = raw_policy;
  if (typeof modelInvocable !== "boolean" || typeof userInvocable !== "boolean") return null;

  const whenToUse = input.whenToUse === undefined ? undefined : text(input.whenToUse);
  if (input.whenToUse !== undefined && whenToUse === undefined) return null;
  const paths = input.paths === undefined ? undefined : strings(input.paths);
  if (input.paths !== undefined && paths === undefined) return null;

  // The run-scoped half of a skill is read with the same reader the loop uses
  // for the control channel, so a provider cannot offer a narrowing this build
  // would refuse to apply.
  const shared = readControl({
    ...(input.allowedTools === undefined ? {} : { tools_allow: input.allowedTools }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
    ...(input.context === undefined ? {} : { context: input.context }),
  });
  if (shared === null) return null;

  const base = input.resourceBase as { kind?: unknown; path?: unknown } | undefined;
  let resourceBase: { kind: "directory"; path: string } | undefined;
  if (base !== undefined) {
    if (base === null || typeof base !== "object" || base.kind !== "directory") return null;
    const path = text(base.path);
    if (path === undefined) return null;
    resourceBase = { kind: "directory", path };
  }

  return {
    name,
    description: input.description,
    source,
    invocation: { modelInvocable, userInvocable },
    rank,
    locator: input.locator ?? null,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    ...(paths === undefined ? {} : { paths }),
    ...(resourceBase === undefined ? {} : { resourceBase }),
    ...(shared.tools_allow === undefined ? {} : { allowedTools: shared.tools_allow }),
    ...(shared.model === undefined ? {} : { model: shared.model }),
    ...(shared.hooks === undefined ? {} : { hooks: shared.hooks }),
    ...(shared.context === undefined ? {} : { context: shared.context }),
  };
}

/// A pattern is written the way a person reads a project tree, so every touched
/// path is offered twice: as it is, and relative to the session directory.
export function pathCandidates(touched: readonly string[], cwd: string): string[] {
  const out: string[] = [];
  const root = toPosix(cwd).replace(/\/+$/, "");
  const insensitive = process.platform === "win32";
  for (const path of touched) {
    const normalized = toPosix(path);
    out.push(normalized);
    if (root === "") continue;
    const head = insensitive ? normalized.toLowerCase() : normalized;
    const wanted = insensitive ? root.toLowerCase() : root;
    if (head.startsWith(wanted + "/")) out.push(normalized.slice(root.length + 1));
  }
  return out;
}

export function isActive(paths: readonly string[] | undefined, candidates: readonly string[]): boolean {
  if (paths === undefined || paths.length === 0) return true;
  return candidates.length > 0 && matchesAnyPath(paths, candidates);
}

export interface Winner {
  candidate: SkillCandidate;
  provider: string;
  summary: SkillSummary;
}

/// A duplicate name is not an error, because two providers offering the same
/// skill is normal, but it is worth reporting: whoever lost may be the version
/// the reader meant.
export interface SkillConflict {
  name: string;
  winner: { provider: string; rank: number; source: string };
  shadowed: Array<{ provider: string; rank: number; source: string }>;
}

export interface Collection {
  skills: SkillSummary[];
  winners: Map<string, Winner>;
  conflicts: SkillConflict[];
  complete: boolean;
}
