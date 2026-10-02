import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CallError } from "@maota/plugin-kit";

export const SETTINGS_FAILURE = {
  conflict: -32060,
} as const;

export const THEMES = ["system", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

const LOCALE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const OWNER_ONLY = 0o600;

export interface SettingsView {
  revision: number;
  locale: string | null;
  theme: Theme | null;
}

interface SettingsFile extends SettingsView {
  schema_version: 1;
}

export interface SettingsStore {
  file: string;
}

export function storeSettings(config: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): SettingsStore {
  const home = env.MAOTA_HOME?.trim() || join(homedir(), ".maota");
  return {
    file: typeof config.file === "string" && config.file.trim() !== "" ? resolve(config.file) : join(home, "settings.json"),
  };
}

export function emptySettings(): SettingsView {
  return { revision: 0, locale: null, theme: null };
}

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function readLocale(value: unknown, fallback: string | null): string | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") throw new CallError(-32602, "locale must be a string or null");
  if (value === "system") return value;
  if (!LOCALE_ID.test(value)) throw new CallError(-32602, `locale must be system or a BCP 47-style id, got ${JSON.stringify(value)}`);
  return value;
}

export function readTheme(value: unknown, fallback: Theme | null): Theme | null {
  if (value === null || value === undefined) return fallback;
  if (!isTheme(value)) throw new CallError(-32602, `theme must be one of ${THEMES.join(", ")} or null`);
  return value;
}

export function readSettingsFile(value: unknown): SettingsView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32603, "settings.json is not an object");
  }
  const raw = value as Record<string, unknown>;
  const revision = raw.revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new CallError(-32603, "settings.json has no valid revision");
  }
  return {
    revision: Number(revision),
    locale: readLocale(raw.locale, null),
    theme: readTheme(raw.theme, null),
  };
}

export function readSettingsFileAt(store: SettingsStore): SettingsView {
  if (!existsSync(store.file)) return emptySettings();
  try {
    return readSettingsFile(JSON.parse(readFileSync(store.file, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof CallError) throw error;
    throw new CallError(-32603, `settings.json could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeSettingsFile(store: SettingsStore, value: SettingsView): void {
  const file: SettingsFile = { schema_version: 1, ...value };
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

export function requireRevision(value: SettingsView, expected: unknown): void {
  if (expected === undefined || expected === null) return;
  if (!Number.isInteger(expected) || expected !== value.revision) {
    throw new CallError(SETTINGS_FAILURE.conflict, "settings changed in another editor; reload before saving", {
      expected: value.revision,
      got: expected,
    });
  }
}
