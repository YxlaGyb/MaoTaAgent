import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STATIC = /^\s*(?:import|export)\b[^;]*?["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const SUFFIXES = ["", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];

function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [STATIC, DYNAMIC]) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (value !== undefined) found.push(value);
    }
  }
  return found;
}

function resolveFile(base: string): string | null {
  for (const suffix of SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    if (seen.has(path) || path.includes("node_modules")) continue;
    seen.add(path);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const specifier of specifiers(text)) {
      if (!specifier.startsWith(".")) continue;
      const next = resolveFile(resolve(dirname(path), specifier));
      if (next !== null) pending.push(next);
    }
  }
  return [...seen];
}