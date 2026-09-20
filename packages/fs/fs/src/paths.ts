import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { CallError } from "@maota/plugin-kit";

export interface Workspace {
  root: string;
  read_roots: readonly string[];
}

export interface PathRequest {
  path: unknown;
  roots: readonly string[];
  write?: boolean;
}

export function existingRoot(dir: unknown): string {
  if (typeof dir !== "string" || dir.trim() === "") {
    throw new CallError(-32602, "cwd must be the session working directory");
  }
  const target = resolve(dir);
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    throw new CallError(-32602, `the working directory ${target} does not exist`);
  }
  if (!statSync(real).isDirectory()) {
    throw new CallError(-32602, `the working directory ${real} is not a directory`);
  }
  return real;
}

function bestEffortRoot(dir: string): string {
  const target = resolve(dir);
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

export function workspace(cwd: unknown, spillDir?: string | null): Workspace {
  const root = existingRoot(cwd);
  const extra =
    typeof spillDir === "string" && spillDir.trim() !== "" ? [bestEffortRoot(spillDir)] : [];
  return { root, read_roots: [root, ...extra] };
}

function inside(root: string, target: string): boolean {
  const rest = relative(root, target);
  return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
}

function deepestReal(target: string): string {
  let current = target;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

function portabilityProblem(value: string): string | null {
  if (value.includes("\0")) return "it holds a null byte";
  const body = /^[A-Za-z]:/.test(value) ? value.slice(2) : value;
  if (body.includes(":")) return "it holds an alternate data stream";
  for (const part of value.split(/[\\/]+/)) {
    if (part === "" || part === "." || part === "..") continue;
    if (/[. ]$/.test(part)) return `the segment ${JSON.stringify(part)} ends with a dot or a space`;
  }
  return null;
}

export function resolvePath(request: PathRequest): string {
  const raw = request.path;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CallError(-32602, "path must be a non-empty string");
  }
  const problem = portabilityProblem(raw);
  if (problem !== null) throw new CallError(-32602, `path ${JSON.stringify(raw)} is not usable: ${problem}`);
  const root = request.roots[0];
  if (root === undefined) throw new CallError(-32602, "path has no working directory to resolve against");
  const target = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  if (!request.roots.some((allowed) => inside(allowed, target))) {
    throw new CallError(-32602, `path ${JSON.stringify(raw)} is outside the working directory`);
  }
  const real = deepestReal(target);
  if (!request.roots.some((allowed) => inside(allowed, real))) {
    throw new CallError(-32602, `path ${JSON.stringify(raw)} resolves outside the working directory`);
  }
  if (request.write === true && lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
    throw new CallError(-32602, `refusing to write through the link ${JSON.stringify(raw)}`);
  }
  return target;
}

export function displayPath(root: string, target: string): string {
  const rest = relative(root, target);
  if (rest === "") return ".";
  if (rest.startsWith("..") || isAbsolute(rest)) return target;
  return rest.split(/[\\/]/).join("/");
}