import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CallError, patternToRegExp } from "@maota/plugin-kit";

export const SCHEMA_VERSION = 2;
export const MODES = ["ask", "auto", "full"] as const;
export const ACTIONS = ["allow", "deny", "ask"] as const;
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DEFAULT_DIRNAME = "default";

/// What an operation that the guard stops is put through: ask the user, approve
/// it without asking, or stop raising the question at all.
export type Mode = (typeof MODES)[number];

/// What a rule says about a tool whose name it matches. `ask` is the one action
/// that survives every mode: a rule that wants a person asked wins over `auto`.
export type RuleAction = (typeof ACTIONS)[number];

export interface Rule {
  match: string;
  action: RuleAction;
}

/// Rules are configuration, so a malformed one is refused where the profile that
/// wrote it can see why rather than quietly becoming no rule at all.
export function readRules(value: unknown): Rule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CallError(-32602, "rules must be a list of { match, action }");
  return value.map((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CallError(-32602, "each rule must be an object with a match and an action");
    }
    const input = raw as Record<string, unknown>;
    if (typeof input.match !== "string" || input.match.trim() === "") {
      throw new CallError(-32602, "each rule needs a non-empty match");
    }
    if (typeof input.action !== "string" || !(ACTIONS as readonly string[]).includes(input.action)) {
      throw new CallError(-32602, `a rule action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(input.action)}`);
    }
    return { match: input.match, action: input.action as RuleAction };
  });
}

/// `allowed-once` is the only grant; a caller treats the other three as a refusal.
export type Outcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

export interface PolicyRecord {
  kind: "policy";
  at: string;
  mode: Mode;
  caller: string;
}

/// A call a subagent made carries the parent's identity and this label, so the
/// question lands under the call that started the subagent and says who is
/// asking.
export interface SubagentRef {
  id: string;
  type?: string;
  description?: string;
}

export interface AskedRecord {
  kind: "asked";
  at: string;
  id: string;
  tool: string;
  call_id?: string;
  reason?: string;
  subagent?: SubagentRef;
}

export interface DecidedRecord {
  kind: "decided";
  at: string;
  id: string;
  outcome: Outcome;
  decided_by: string;
  cause?: string;
  tool?: string;
  subagent?: SubagentRef;
}

/// A grant is why a tool stopped being asked about, and a withdrawal is why it
/// started being asked again: both belong in the trail, not only in the state.
export interface GrantRecord {
  kind: "grant";
  at: string;
  tool: string;
  caller: string;
  revoked?: true;
}

export type AuditRecord = PolicyRecord | AskedRecord | DecidedRecord | GrantRecord;

export interface PermissionFile {
  schema_version: number;
  session_id: string;
  cwd: string;
  mode: Mode | null;
  grants: string[];
  records: AuditRecord[];
}

/// A policy that answers a call by itself, with the label its audit record
/// carries, or `unavailable` for a question nobody can answer.
export interface Verdict {
  outcome: Outcome;
  decided_by: string;
  cause?: string;
}

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function sessionIdOf(value: unknown): string {
  const id = String(value ?? "");
  if (!SESSION_ID.test(id)) {
    throw new CallError(-32602, `session_id must match ${SESSION_ID.source}, got ${JSON.stringify(value)}`);
  }
  return id;
}

/// A subagent that cannot be named is a caller bug rather than a question, so
/// it is refused where the caller can see why; an absent one is simply a call
/// made by the session itself.
export function subagentOf(value: unknown): SubagentRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, `subagent must be an object, got ${JSON.stringify(value)}`);
  }
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  if (typeof id !== "string" || id === "") {
    throw new CallError(-32602, `subagent.id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  const text = (name: string): string | undefined => {
    const found = raw[name];
    if (found === undefined || found === null) return undefined;
    if (typeof found !== "string") {
      throw new CallError(-32602, `subagent.${name} must be a string, got ${JSON.stringify(found)}`);
    }
    return found;
  };
  const type = text("type");
  const description = text("description");
  return {
    id,
    ...(type === undefined ? {} : { type }),
    ...(description === undefined ? {} : { description }),
  };
}

export function encodeDir(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  return trimmed === "" ? DEFAULT_DIRNAME : trimmed.replace(/[^A-Za-z0-9]/g, "-");
}

export function filePath(root: string, sessionId: string, cwd: string): string {
  return join(root, encodeDir(cwd), `${sessionId}.json`);
}

export function effectiveMode(file: PermissionFile, fallback: Mode): Mode {
  return file.mode ?? fallback;
}

/// The decision table, strictest first: a rule that refuses, then a grant from a
/// remembered answer, then a rule that allows or asks, then the mode. `ask` is
/// the only answer that needs somebody, and with nobody listening it fails
/// closed rather than open.
export function decide(
  mode: Mode,
  answerers: number,
  tool: string,
  rules: readonly Rule[],
  grants: readonly string[],
): Verdict | "ask" {
  const rule = rules.find((item) => new RegExp(patternToRegExp(item.match)).test(tool));
  if (rule?.action === "deny") return { outcome: "rejected", decided_by: "policy:rule", cause: `rule ${rule.match}` };
  if (grants.includes(tool)) return { outcome: "allowed-once", decided_by: "policy:remember" };
  if (rule?.action === "allow") return { outcome: "allowed-once", decided_by: "policy:rule", cause: `rule ${rule.match}` };
  if (rule?.action === "ask") {
    return answerers === 0 ? { outcome: "unavailable", decided_by: "none", cause: "no-answerer" } : "ask";
  }
  if (mode === "full") return { outcome: "allowed-once", decided_by: "policy:full" };
  if (mode === "auto") return { outcome: "allowed-once", decided_by: "policy:auto" };
  if (answerers === 0) return { outcome: "unavailable", decided_by: "none", cause: "no-answerer" };
  return "ask";
}

/// Every `asked` needs exactly one `decided`, and a `decided` without one is
/// legal only for a decision the policy made by itself.
export function pairingProblems(records: readonly AuditRecord[]): string[] {
  const asked = new Set<string>();
  const decided = new Map<string, number>();
  for (const record of records) {
    if (record.kind === "asked") asked.add(record.id);
    if (record.kind === "decided") decided.set(record.id, (decided.get(record.id) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const id of asked) {
    const count = decided.get(id) ?? 0;
    if (count !== 1) problems.push(`asked ${id} has ${count} decided records`);
  }
  for (const record of records) {
    if (record.kind !== "decided" || asked.has(record.id)) continue;
    if (!record.decided_by.startsWith("policy:")) {
      problems.push(`decided ${record.id} has no asked record and is not a policy decision`);
    }
  }
  return problems;
}

/// Keeps the newest `maxRecords`, never splitting an ask from its decision: a
/// head that lost its question goes with it.
function trim(records: readonly AuditRecord[], maxRecords: number): AuditRecord[] {
  const kept = records.slice(Math.max(0, records.length - maxRecords));
  for (;;) {
    const first = kept[0];
    if (first === undefined || first.kind !== "decided" || first.decided_by.startsWith("policy:")) return kept;
    kept.shift();
  }
}

function emptyFile(sessionId: string, cwd: string): PermissionFile {
  return { schema_version: SCHEMA_VERSION, session_id: sessionId, cwd, mode: null, grants: [], records: [] };
}

export function read(root: string, sessionId: string, cwd: string): PermissionFile {
  let text: string;
  try {
    text = readFileSync(filePath(root, sessionId, cwd), "utf8");
  } catch {
    return emptyFile(sessionId, cwd);
  }
  try {
    const parsed = JSON.parse(text) as PermissionFile;
    if (typeof parsed?.session_id !== "string" || !Array.isArray(parsed.records)) return emptyFile(sessionId, cwd);
    return {
      ...parsed,
      mode: isMode(parsed.mode) ? parsed.mode : null,
      grants: Array.isArray(parsed.grants) ? parsed.grants.filter((tool) => typeof tool === "string") : [],
    };
  } catch {
    return emptyFile(sessionId, cwd);
  }
}

export function write(root: string, file: PermissionFile, maxRecords: number): PermissionFile {
  const next: PermissionFile = { ...file, records: trim(file.records, maxRecords) };
  const path = filePath(root, file.session_id, file.cwd);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return next;
}
