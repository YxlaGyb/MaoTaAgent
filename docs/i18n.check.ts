#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

const root = join(import.meta.dirname, "..");

function at(path: string): string {
  return relative(root, path).split("\\").join("/");
}
const SKIP = new Set(["node_modules", ".git", "dist", "target", "ui"]);
const RECORD_HEADER = [
  "# Bilingual-pair consistency record (docs/i18n.check.ts): the git blob hash of each",
  "# side as of the last confirmed-consistent state. Both languages carry equal authority;",
  "# after editing either side, bring the other along and re-record with:",
  "#   pnpm run i18n:write <x.md>",
];

function blobHash(content: Buffer): string {
  const normalized = Buffer.from(content.toString("utf8").split("\r\n").join("\n"), "utf8");
  return createHash("sha1").update(`blob ${normalized.length}\0`, "utf8").update(normalized).digest("hex");
}

function pairsUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) pairsUnder(join(dir, entry.name), found);
    } else if (entry.name.endsWith(".zh.md")) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function switcherOf(text: string, want: string): boolean {
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.startsWith("# "));
  if (heading < 0) return false;
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (lines[i]!.trim() === "") continue;
    return lines[i]!.trim() === want;
  }
  return false;
}

function recordedHashes(record: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of readFileSync(record, "utf8").split(/\r?\n/)) {
    const match = /^(\S+\.md): ([0-9a-f]{40})$/.exec(line);
    if (match) hashes.set(match[1]!, match[2]!);
  }
  return hashes;
}

function recordPair(english: string): void {
  const chinese = english.replace(/\.md$/, ".zh.md");
  const record = english.replace(/\.md$/, ".i18n.yaml");
  const lines = [
    ...RECORD_HEADER,
    `${basename(english)}: ${blobHash(readFileSync(english))}`,
    `${basename(chinese)}: ${blobHash(readFileSync(chinese))}`,
  ];
  writeFileSync(record, lines.join("\n") + "\n");
  console.log(`i18n: recorded ${at(record)}`);
}

const argv = process.argv.slice(2);
if (argv[0] === "--write") {
  const given = argv.slice(1);
  if (given.length === 0) {
    console.error("usage: node docs/i18n.check.ts --write <x.md|x.zh.md>");
    process.exit(2);
  }
  for (const path of given) {
    const english = join(root, path.replace(/\.zh\.md$/, ".md"));
    for (const side of [english, english.replace(/\.md$/, ".zh.md")]) {
      if (!existsSync(side)) {
        console.error(`${path}: missing ${at(side)}`);
        process.exit(2);
      }
    }
    recordPair(english);
  }
  process.exit(0);
}

const problems: string[] = [];
const skipped: string[] = [];
let checked = 0;

for (const chinese of pairsUnder(root)) {
  const english = chinese.replace(/\.zh\.md$/, ".md");
  const record = chinese.replace(/\.zh\.md$/, ".i18n.yaml");
  const pair = at(english);

  if (!existsSync(english)) {
    problems.push(`${pair}: the Chinese side exists but ${basename(english)} does not`);
    continue;
  }
  const englishText = readFileSync(english, "utf8");
  const chineseText = readFileSync(chinese, "utf8");
  if (englishText === "" && chineseText === "") {
    skipped.push(pair);
    continue;
  }
  if (englishText === "" || chineseText === "") {
    problems.push(`${pair}: one side is empty (${englishText === "" ? basename(english) : basename(chinese)})`);
    continue;
  }
  checked += 1;

  if (!switcherOf(englishText, `English | [中文](${basename(chinese)})`)) {
    problems.push(`${pair}: the line under the H1 must be \`English | [中文](${basename(chinese)})\``);
  }
  if (!switcherOf(chineseText, `[English](${basename(english)}) | 中文`)) {
    problems.push(`${at(chinese)}: the line under the H1 must be \`[English](${basename(english)}) | 中文\``);
  }
  if (!existsSync(record)) {
    problems.push(`${pair}: missing ${basename(record)} (pnpm run i18n:write ${pair})`);
    continue;
  }
  const want = recordedHashes(record);
  for (const [side, hash] of [
    [basename(english), blobHash(Buffer.from(englishText, "utf8"))],
    [basename(chinese), blobHash(Buffer.from(chineseText, "utf8"))],
  ] as const) {
    if (want.get(side) !== hash) {
      problems.push(`${pair}: ${side} does not match the record (pnpm run i18n:write ${pair})`);
    }
  }
}

for (const path of skipped) console.log(`i18n: skipped empty placeholder ${path}`);
for (const problem of problems) console.error(`i18n: ${problem}`);
if (problems.length > 0) {
  console.error(`i18n: ${problems.length} problems`);
  process.exit(1);
}
console.log(`i18n ok: ${checked} pairs`);
