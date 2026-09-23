/// The permission settings a deployment runs with, the readers a request is
/// read through, and the grant list beside them. This module sits at the bottom
/// of the package: the file a session's decisions live in is opened here, and
/// the audit trail as well as the question queue import their way up from it.

import { homedir } from "node:os";
import { join } from "node:path";

import { CallError, type Call } from "@maota/plugin-kit";

import {
  MODES,
  effectiveMode,
  isMode,
  read,
  sessionIdOf,
  write,
  type AuditRecord,
  type GrantRecord,
  type Mode,
  type PermissionFile,
  type Rule,
} from "./store.ts";

export const DEFAULTS = { mode: "ask" as Mode, maxRecords: 500, remember: false };

export interface Settings {
  root: string;
  mode: Mode;
  maxRecords: number;
  remember: boolean;
  rules: Rule[];
}

export interface Target {
  sessionId: string;
  cwd: string;
}

export function defaultRoot(): string {
  const home = process.env.MAOTA_HOME;
  return join(home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota"), "permissions");
}

export let settings: Settings = {
  root: defaultRoot(),
  mode: DEFAULTS.mode,
  maxRecords: DEFAULTS.maxRecords,
  remember: DEFAULTS.remember,
  rules: [],
};

/// The settings are swapped rather than patched: `setup` installs the
/// deployment's configuration and `selfCheck` borrows the slot to put it back,
/// so both go through this one door.
export function configure(next: Settings): void {
  settings = next;
}

export function now(): string {
  return new Date().toISOString();
}

export function text(value: unknown, name: string): string {
  const found = String(value ?? "");
  if (found === "") throw new CallError(-32602, `${name} must be a non-empty string`);
  return found;
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function targetOf(params: unknown): Target {
  const input = (params ?? {}) as { session_id?: unknown; cwd?: unknown };
  return { sessionId: sessionIdOf(input.session_id), cwd: typeof input.cwd === "string" ? input.cwd : "" };
}

export function answererId(call: Call): string {
  return call.caller === "" ? "answerer" : call.caller;
}

export function fileOf(target: Target): PermissionFile {
  return read(settings.root, target.sessionId, target.cwd);
}

export function policy(params: unknown): { mode: Mode; grants: string[] } {
  const target = targetOf(params);
  const file = fileOf(target);
  return { mode: effectiveMode(file, settings.mode), grants: file.grants };
}

export function setPolicy(params: unknown, call: Call): { mode: Mode } {
  const target = targetOf(params);
  const wanted = (params ?? {}) as { mode?: unknown };
  if (!isMode(wanted.mode)) {
    throw new CallError(-32602, `mode must be one of ${MODES.join(", ")}, got ${JSON.stringify(wanted.mode)}`);
  }
  const file = fileOf(target);
  if (effectiveMode(file, settings.mode) === wanted.mode) return { mode: wanted.mode };
  const record: AuditRecord = { kind: "policy", at: now(), mode: wanted.mode, caller: call.caller };
  write(settings.root, { ...file, mode: wanted.mode, records: [...file.records, record] }, settings.maxRecords);
  return { mode: wanted.mode };
}

/// A remembered answer is a grant, and a grant is written where the decision it
/// replaced is written: the file is the record of why a tool stopped asking.
export function grant(target: Target, tool: string, caller: string): void {
  const file = fileOf(target);
  if (file.grants.includes(tool)) return;
  const record: GrantRecord = { kind: "grant", at: now(), tool, caller };
  write(settings.root, { ...file, grants: [...file.grants, tool], records: [...file.records, record] }, settings.maxRecords);
}

export function forget(params: unknown, call: Call): { grants: string[] } {
  const target = targetOf(params);
  const input = (params ?? {}) as { tool?: unknown };
  const only = optionalText(input.tool);
  const file = fileOf(target);
  const kept = only === undefined ? [] : file.grants.filter((item) => item !== only);
  const revoked = file.grants.filter((item) => !kept.includes(item));
  if (revoked.length === 0) return { grants: file.grants };
  const records: GrantRecord[] = revoked.map((tool) => ({
    kind: "grant",
    at: now(),
    tool,
    caller: answererId(call),
    revoked: true,
  }));
  const next = write(
    settings.root,
    { ...file, grants: kept, records: [...file.records, ...records] },
    settings.maxRecords,
  );
  return { grants: next.grants };
}
