#!/usr/bin/env node
/// Two rules about the interface's words.
///
/// One, copy is never written in code: a sentence a person reads lives in a
/// dictionary, so it can be translated without editing the thing that shows it.
/// Two, every dictionary answers the same keys: a language that is missing one
/// shows a key to a reader, which reads as a bug in the product rather than as
/// a gap in the translation.
///
/// A key somebody asks for that no dictionary has is not checked here. It is
/// caught by the type system, because the lookup is typed by the dictionary
/// that owns the words.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "dist", "target", "tmp"]);
/// The `i18n` packages are the translation machinery, and are deliberately
/// absent: the language table must spell every language in its own script
/// before any dictionary can exist, and the fixtures that prove the resolver
/// works must hold text with something to resolve. Everywhere else, a word a
/// person reads belongs in a dictionary.
const WATCHED = ["packages", "apps"];
const DICTIONARY_DIR = "locales";
/// Han, Hiragana, Katakana, Hangul and the compatibility blocks: everything a
/// repository written in English has no reason to hold, and which no longer
/// belongs in code now that dictionaries exist.
const COPY = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

function at(path: string): string {
  return relative(root, path).split("\\").join("/");
}

/// A `lib` directory that is a package's build output is skipped; one that is a
/// source directory is walked, because a name is not what makes a directory
/// generated.
function generated(directory: string): boolean {
  const name = directory.split(/[\\/]/).pop() ?? "";
  if (SKIP.has(name)) return true;
  return name === "lib" && existsSync(join(dirname(directory), "package.json"));
}

function sourcesUnder(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!generated(path)) sourcesUnder(path, found);
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function isDictionary(file: string): boolean {
  return dirname(file).split(/[\\/]/).pop() === DICTIONARY_DIR;
}

/// A test is not the interface. A test that pushes a non-ASCII string through a
/// shell is checking that the shell carries it, not saying something to a
/// person, so it is allowed to hold characters the product may not.
function inTests(file: string): boolean {
  return at(file).split("/").includes("tests");
}

const files = WATCHED.flatMap((dir) => sourcesUnder(join(root, dir)));

const copied: string[] = [];
for (const file of files) {
  if (isDictionary(file) || inTests(file)) continue;
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (COPY.test(line)) copied.push(`${at(file)}:${index + 1}`);
    });
}

const dictionaries = files.filter(isDictionary);

interface Dictionary {
  file: string;
  locale: string;
  messages: Record<string, string>;
}

const loaded: Dictionary[] = [];
const broken: string[] = [];
for (const file of dictionaries) {
  const module = (await import(pathToFileURL(file).href)) as {
    locale?: unknown;
    messages?: unknown;
  };
  const locale = module.locale;
  const messages = module.messages;
  if (typeof locale !== "string" || messages === null || typeof messages !== "object" || Array.isArray(messages)) {
    broken.push(`${at(file)} does not export a locale and a messages object`);
    continue;
  }
  const words: Record<string, string> = {};
  for (const [key, text] of Object.entries(messages as Record<string, unknown>)) {
    if (typeof text !== "string") broken.push(`${at(file)} keys ${key} to something that is not a sentence`);
    else words[key] = text;
  }
  loaded.push({ file, locale, messages: words });
}

const mismatched: string[] = [];
const byOwner = new Map<string, Dictionary[]>();
for (const dictionary of loaded) {
  const owner = dirname(dirname(dictionary.file));
  const group = byOwner.get(owner) ?? [];
  group.push(dictionary);
  byOwner.set(owner, group);
}

for (const group of byOwner.values()) {
  const ordered = [...group].sort((left, right) => left.file.localeCompare(right.file));
  const reference = ordered[0]!;
  const wanted = new Set(Object.keys(reference.messages));
  for (const dictionary of ordered.slice(1)) {
    const has = new Set(Object.keys(dictionary.messages));
    const missing = [...wanted].filter((key) => !has.has(key)).sort();
    const extra = [...has].filter((key) => !wanted.has(key)).sort();
    if (missing.length > 0) {
      mismatched.push(`${at(dictionary.file)} is missing ${missing.length} of ${reference.locale}'s keys: ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
      mismatched.push(`${at(dictionary.file)} writes ${extra.length} keys ${reference.locale} does not have: ${extra.join(", ")}`);
    }
  }
  const seen = new Map<string, string>();
  for (const dictionary of ordered) {
    const first = seen.get(dictionary.locale);
    if (first !== undefined) mismatched.push(`${at(dictionary.file)} and ${at(first)} both declare ${dictionary.locale}`);
    seen.set(dictionary.locale, dictionary.file);
  }
}

const problems = [...broken, ...mismatched, ...copied];
for (const problem of problems) console.log(`  ${problem}`);
console.log(
  problems.length === 0
    ? `i18n ok: ${files.length} files carry no copy, ${dictionaries.length} dictionaries agree`
    : `${problems.length} i18n problems (${copied.length} hardcoded, ${broken.length + mismatched.length} in dictionaries)`,
);
if (problems.length > 0) process.exitCode = 1;
