import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CallError } from "@maota/plugin-kit";

export const WORKSPACE_FAILURE = {
  conflict: -32061,
} as const;

const OWNER_ONLY = 0o600;

export interface WorkspaceProject {
  path: string;
  name: string | null;
}

export interface WorkspaceView {
  revision: number;
  projects: WorkspaceProject[];
  pinned_sessions: string[];
  archived_sessions: string[];
}

interface WorkspaceFile extends WorkspaceView {
  schema_version: 1;
}

export interface WorkspaceStore {
  file: string;
}

export function storeWorkspace(config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): WorkspaceStore {
  const home = env.MAOTA_HOME?.trim() || join(homedir(), ".maota");
  return {
    file: typeof config.file === "string" && config.file.trim() !== "" ? resolve(config.file) : join(home, "workspaces.json"),
  };
}

export function emptyWorkspace(): WorkspaceView {
  return { revision: 0, projects: [], pinned_sessions: [], archived_sessions: [] };
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new CallError(-32603, `workspaces.json ${field} is not an array`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "") throw new CallError(-32603, `workspaces.json ${field} has an invalid id`);
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function projectsOf(value: unknown): WorkspaceProject[] {
  if (!Array.isArray(value)) throw new CallError(-32603, "workspaces.json projects is not an array");
  const projects: WorkspaceProject[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new CallError(-32603, "workspaces.json has an invalid project");
    const raw = item as { path?: unknown; name?: unknown };
    if (typeof raw.path !== "string" || raw.path.trim() === "") throw new CallError(-32603, "workspaces.json has a project without a path");
    if (raw.name !== null && raw.name !== undefined && typeof raw.name !== "string") {
      throw new CallError(-32603, "workspaces.json has a project with an invalid name");
    }
    if (projects.some((project) => project.path === raw.path)) continue;
    projects.push({ path: raw.path, name: typeof raw.name === "string" && raw.name !== "" ? raw.name : null });
  }
  return projects;
}

export function readWorkspaceFile(value: unknown): WorkspaceView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32603, "workspaces.json is not an object");
  }
  const raw = value as Record<string, unknown>;
  if (!Number.isInteger(raw.revision) || Number(raw.revision) < 0) {
    throw new CallError(-32603, "workspaces.json has no valid revision");
  }
  return {
    revision: Number(raw.revision),
    projects: projectsOf(raw.projects),
    pinned_sessions: stringArray(raw.pinned_sessions, "pinned_sessions"),
    archived_sessions: stringArray(raw.archived_sessions, "archived_sessions"),
  };
}

export function readWorkspaceFileAt(store: WorkspaceStore): WorkspaceView {
  if (!existsSync(store.file)) return emptyWorkspace();
  try {
    return readWorkspaceFile(JSON.parse(readFileSync(store.file, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof CallError) throw error;
    throw new CallError(-32603, `workspaces.json could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeWorkspaceFile(store: WorkspaceStore, value: WorkspaceView): void {
  const file: WorkspaceFile = { schema_version: 1, ...value };
  mkdirSync(dirname(store.file), { recursive: true });
  const temp = `${store.file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: OWNER_ONLY });
    renameSync(temp, store.file);
    chmodSync(store.file, OWNER_ONLY);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function requireRevision(value: WorkspaceView, expected: unknown): void {
  if (expected === undefined || expected === null) return;
  if (!Number.isInteger(expected) || expected !== value.revision) {
    throw new CallError(WORKSPACE_FAILURE.conflict, "workspaces changed in another editor; reload before saving", {
      expected: value.revision,
      got: expected,
    });
  }
}

export function pathOf(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new CallError(-32602, "workspace path is required");
  return value.trim();
}

export function idOf(value: unknown, field = "session_id"): string {
  if (typeof value !== "string" || value.trim() === "") throw new CallError(-32602, `workspace ${field} is required`);
  return value.trim();
}

export function changed(current: WorkspaceView, patch: Partial<Omit<WorkspaceView, "revision">>): WorkspaceView {
  return { ...current, ...patch, revision: current.revision + 1 };
}
