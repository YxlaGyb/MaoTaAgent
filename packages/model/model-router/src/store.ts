import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CallError } from "@maota/plugin-kit";
import { MODEL_FAILURE, readCatalog, type ModelCatalog, type ProviderProfile } from "@maota/model-protocol";

const OWNER_ONLY = 0o600;

export interface StoreSettings {
  file: string;
  credentials: string;
}

export function storeSettings(config: Record<string, unknown>): StoreSettings {
  const home = process.env.MAOTA_HOME?.trim() || join(homedir(), ".maota");
  return {
    file: typeof config.file === "string" && config.file.trim() !== "" ? resolve(config.file) : join(home, "models.json"),
    credentials: join(home, "credentials"),
  };
}

export function emptyCatalog(): ModelCatalog {
  return { revision: 0, providers: [], models: [], default_route: null };
}

export function readCatalogFile(settings: StoreSettings): ModelCatalog {
  if (!existsSync(settings.file)) return emptyCatalog();
  try {
    return readCatalog(JSON.parse(readFileSync(settings.file, "utf8")));
  } catch (error) {
    throw new CallError(
      -32603,
      `models.json could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeCatalogFile(settings: StoreSettings, catalog: ModelCatalog): void {
  mkdirSync(dirname(settings.file), { recursive: true });
  const temp = `${settings.file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", mode: OWNER_ONLY });
    renameSync(temp, settings.file);
    chmodSync(settings.file, OWNER_ONLY);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function keyPath(settings: StoreSettings, provider: string): string {
  return join(settings.credentials, `${provider}.key`);
}

export function readProviderKey(settings: StoreSettings, provider: ProviderProfile): string {
  if (provider.auth.kind === "env") return (process.env[provider.auth.name] ?? "").trim();
  try {
    return readFileSync(keyPath(settings, provider.id), "utf8").trim();
  } catch {
    return "";
  }
}

export function writeProviderKey(settings: StoreSettings, provider: string, value: string): void {
  const path = keyPath(settings, provider);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value === "" ? "" : `${value}\n`, { encoding: "utf8", mode: OWNER_ONLY });
  chmodSync(path, OWNER_ONLY);
}

export function removeProviderKey(settings: StoreSettings, provider: string): void {
  rmSync(keyPath(settings, provider), { force: true });
}

export function keyConfigured(settings: StoreSettings, provider: ProviderProfile): boolean {
  return readProviderKey(settings, provider) !== "";
}

export function requireRevision(catalog: ModelCatalog, expected: unknown): void {
  if (expected === undefined || expected === null) return;
  if (!Number.isInteger(expected) || expected !== catalog.revision) {
    throw new CallError(MODEL_FAILURE.conflict, "models.json changed in another editor; reload before saving", {
      expected: catalog.revision,
      got: expected,
    });
  }
}

export function findProvider(catalog: ModelCatalog, id: string): ProviderProfile {
  const provider = catalog.providers.find((item) => item.id === id);
  if (provider === undefined) throw new CallError(-32602, `unknown provider: ${id}`);
  return provider;
}

export function findModel(catalog: ModelCatalog, provider: string, model: string) {
  const found = catalog.models.find((item) => item.provider === provider && item.model === model);
  if (found === undefined) throw new CallError(-32602, `unknown model: ${provider}/${model}`);
  return found;
}

export function assertRoute(catalog: ModelCatalog, provider: string, model: string): void {
  findProvider(catalog, provider);
  findModel(catalog, provider, model);
}
