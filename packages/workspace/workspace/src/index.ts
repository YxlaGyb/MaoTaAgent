#!/usr/bin/env node
import { CallError, isPluginEntry, runPlugin, type Definition } from "@maota/plugin-kit";

import {
  changed,
  emptyWorkspace,
  idOf,
  pathOf,
  readWorkspaceFile,
  readWorkspaceFileAt,
  requireRevision,
  storeWorkspace,
  writeWorkspaceFile,
  type WorkspaceStore,
  type WorkspaceView,
} from "./store.ts";

let workspace: WorkspaceStore = storeWorkspace({});

function nameOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new CallError(-32602, "workspace name must be a string or null");
  const name = value.trim();
  return name === "" ? null : name;
}

function same(left: WorkspaceView, right: WorkspaceView): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyProject(current: WorkspaceView, path: string, name: string | null, rename: boolean): WorkspaceView {
  const found = current.projects.find((project) => project.path === path);
  if (found === undefined) {
    if (rename) throw new CallError(-32602, `unknown workspace: ${path}`);
    return changed(current, { projects: [...current.projects, { path, name }] });
  }
  const nextName = rename ? name : (name ?? found.name);
  if (found.name === nextName) return current;
  return changed(current, {
    projects: current.projects.map((project) => project.path === path ? { path, name: nextName } : project),
  });
}

function removeProject(current: WorkspaceView, path: string): WorkspaceView {
  if (!current.projects.some((project) => project.path === path)) return current;
  return changed(current, { projects: current.projects.filter((project) => project.path !== path) });
}

function setPin(current: WorkspaceView, id: string, pinned: boolean): WorkspaceView {
  const present = current.pinned_sessions.includes(id);
  const archived = current.archived_sessions.includes(id);
  if (pinned === present && (!pinned || !archived)) return current;
  const pinned_sessions = pinned
    ? [id, ...current.pinned_sessions.filter((item) => item !== id)]
    : current.pinned_sessions.filter((item) => item !== id);
  return changed(current, {
    pinned_sessions,
    ...(pinned && archived ? { archived_sessions: current.archived_sessions.filter((item) => item !== id) } : {}),
  });
}

function setArchive(current: WorkspaceView, id: string, archived: boolean): WorkspaceView {
  const present = current.archived_sessions.includes(id);
  if (archived === present) return current;
  return changed(current, {
    pinned_sessions: archived ? current.pinned_sessions.filter((item) => item !== id) : current.pinned_sessions,
    archived_sessions: archived
      ? [...current.archived_sessions.filter((item) => item !== id), id]
      : current.archived_sessions.filter((item) => item !== id),
  });
}

function selfCheck(): string[] {
  const problems: string[] = [];
  const empty = emptyWorkspace();
  if (empty.projects.length !== 0 || empty.revision !== 0) problems.push("empty workspace is wrong");
  const added = applyProject(empty, "E:\\proj", "Project", false);
  if (added.projects[0]?.path !== "E:\\proj" || added.revision !== 1) problems.push("workspace registration is wrong");
  const once = setPin(added, "s1", true);
  const twice = setPin(once, "s1", true);
  if (once.revision !== 2 || twice.revision !== 2) problems.push("pin is not idempotent");
  const archived = setArchive(once, "s1", true);
  if (archived.pinned_sessions.length !== 0 || archived.archived_sessions[0] !== "s1") problems.push("archive did not remove pin");
  const restored = setArchive(archived, "s1", false);
  if (restored.archived_sessions.length !== 0 || restored.pinned_sessions.length !== 0) problems.push("restore restored a pin");
  const value = readWorkspaceFile({ revision: 3, projects: [{ path: "p", name: null }], pinned_sessions: ["a"], archived_sessions: ["b"] });
  if (value.revision !== 3 || value.projects[0]?.path !== "p") problems.push("workspace document was read wrong");
  return problems;
}

export const definition: Definition = {
  provides: ["workspace"],
  injects: [],
  registrations: [],
  hostCalls: [],
  configKeys: ["file"],

  setup(wiring) {
    workspace = storeWorkspace(wiring.config);
  },

  methods: {
    get() {
      return readWorkspaceFileAt(workspace);
    },

    async register(params, ctx) {
      return await write(workspace, ctx, (current) => applyProject(current, pathOf(params?.path), nameOf(params?.name), false), params?.expected_revision);
    },

    async rename(params, ctx) {
      return await write(workspace, ctx, (current) => applyProject(current, pathOf(params?.path), nameOf(params?.name), true), params?.expected_revision);
    },

    async remove(params, ctx) {
      return await write(workspace, ctx, (current) => removeProject(current, pathOf(params?.path)), params?.expected_revision);
    },

    async set_pin(params, ctx) {
      if (typeof params?.pinned !== "boolean") throw new CallError(-32602, "workspace pinned must be a boolean");
      return await write(workspace, ctx, (current) => setPin(current, idOf(params?.session_id), params.pinned), params?.expected_revision);
    },

    async set_archive(params, ctx) {
      if (typeof params?.archived !== "boolean") throw new CallError(-32602, "workspace archived must be a boolean");
      return await write(workspace, ctx, (current) => setArchive(current, idOf(params?.session_id), params.archived), params?.expected_revision);
    },
  },

  selfCheck,
};

async function write(
  store: WorkspaceStore,
  ctx: Parameters<NonNullable<Definition["methods"][string]>>[1],
  update: (current: WorkspaceView) => WorkspaceView,
  expected: unknown,
): Promise<WorkspaceView> {
  const current = readWorkspaceFileAt(store);
  requireRevision(current, expected);
  const next = update(current);
  if (same(current, next)) return current;
  writeWorkspaceFile(store, next);
  await ctx.channel.publish("workspace.changed", next);
  return next;
}

if (isPluginEntry(import.meta.url)) runPlugin(definition);
