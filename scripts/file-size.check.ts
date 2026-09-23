#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const LIMIT = 500;
const SKIP = new Set(["node_modules", ".git", "dist", "lib", "target", "tmp"]);
const WATCHED = ["packages", "apps", "i18n", "scripts", "docs"];

function at(path: string): string {
  return relative(root, path).split("\\").join("/");
}

function sourcesUnder(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sourcesUnder(join(dir, entry.name), found);
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function linesOf(file: string): number {
  const text = readFileSync(file, "utf8");
  const count = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? count - 1 : count;
}

const files = WATCHED.flatMap((dir) => sourcesUnder(join(root, dir)));
const over = files
  .map((file) => ({ file, lines: linesOf(file) }))
  .filter((entry) => entry.lines > LIMIT)
  .sort((left, right) => right.lines - left.lines);

for (const { file, lines } of over) console.log(`${String(lines).padStart(5)}  ${at(file)}`);
console.log(
  over.length === 0
    ? `file size ok: ${files.length} files, none over ${LIMIT} lines`
    : `${over.length} files over ${LIMIT} lines`,
);
if (over.length > 0) process.exitCode = 1;
