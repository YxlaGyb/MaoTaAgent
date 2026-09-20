import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { kernel as installedKernel } from "eggshell-kernel";

export const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

export interface ConfigChoice {
  explicit?: string | undefined;
  env?: NodeJS.ProcessEnv;
  profile?: string | undefined;
  home?: string | undefined;
}

export interface KernelChoice {
  explicit?: string | undefined;
  env?: NodeJS.ProcessEnv;
  installed?: string | null;
  root?: string;
}

export interface PluginRow {
  id: string;
  name: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
}

export interface ProfileTemplate {
  bundles: readonly string[];
}

export const DEFAULT_PROFILE = "default";

export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  default: { bundles: ["@maota/base"] },
  serve: { bundles: ["@maota/base", "@maota/web-bundle"] },
};

const PROFILES = "profiles";
const GENERATED = "eggshell.toml";
const USER_LAYER = "eggshell.local.toml";

interface BundleManifest {
  maota?: { bundle?: { rows?: string } };
}

interface ProfileManifest {
  maota?: { profile?: { bundles?: string[] } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function maotaHome(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.MAOTA_HOME;
  return named !== undefined && named !== "" ? named : join(homedir(), ".maota");
}

export function profileDir(home: string, profile: string): string {
  if (!Object.hasOwn(PROFILE_TEMPLATES, profile)) {
    throw new Error(`maota: unknown profile ${JSON.stringify(profile)} (known: ${Object.keys(PROFILE_TEMPLATES).join(", ")})`);
  }
  return join(home, PROFILES, profile);
}

function requireFrom(root: string) {
  return createRequire(join(root, "package.json"));
}

export function packageDir(name: string, root: string = repoRoot): string {
  try {
    return dirname(requireFrom(root).resolve(`${name}/package.json`));
  } catch (error) {
    throw new Error(`maota: cannot find ${name} from ${root}: ${messageOf(error)}`);
  }
}

export function entryOf(name: string, root: string = repoRoot): string {
  try {
    return requireFrom(root).resolve(name);
  } catch (error) {
    throw new Error(`maota: cannot resolve the entry of ${name} from ${root}: ${messageOf(error)}`);
  }
}

export function bundlesOfProfile(dir: string, profile: string): readonly string[] {
  const manifest = join(dir, "package.json");
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as ProfileManifest;
    const bundles = parsed.maota?.profile?.bundles;
    if (Array.isArray(bundles) && bundles.length > 0) return bundles;
  }
  const template = PROFILE_TEMPLATES[profile];
  return template === undefined ? [] : template.bundles;
}

async function rowsOfBundle(bundle: string, root: string): Promise<PluginRow[]> {
  const dir = packageDir(bundle, root);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as BundleManifest;
  const rows = manifest.maota?.bundle?.rows;
  if (typeof rows !== "string" || rows === "") {
    throw new Error(`maota: the bundle ${bundle} declares no maota.bundle.rows`);
  }
  const loaded = (await import(pathToFileURL(join(dir, rows)).href)) as { rows?: PluginRow[] };
  if (!Array.isArray(loaded.rows)) throw new Error(`maota: the bundle ${bundle} exports no rows array`);
  return loaded.rows;
}

export async function rowsOfBundles(bundles: readonly string[], root: string = repoRoot): Promise<PluginRow[]> {
  const rows: PluginRow[] = [];
  const owner = new Map<string, string>();
  for (const bundle of bundles) {
    for (const row of await rowsOfBundle(bundle, root)) {
      const earlier = owner.get(row.id);
      if (earlier !== undefined) {
        throw new Error(`maota: plugin id ${row.id} is listed twice: by ${earlier} and by ${bundle}`);
      }
      owner.set(row.id, bundle);
      rows.push(row);
    }
  }
  return rows;
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  throw new Error(`a config value has no TOML form: ${JSON.stringify(value)}`);
}

const HEADER: string[] = [
  "# MaoTa's plugin set for one profile: one provider per capability id.",
  "#",
  "# Generated from the bundles this profile lists (maota.profile.bundles in the package.json",
  "# beside this file). A bundle names its rows by package, and every row names the package to",
  "# run: the kernel resolves it out of the node_modules chain that starts here, so no row",
  "# pins this machine's layout. Never edit this file: overrides belong in",
  "# eggshell.local.toml beside it, which extends this one and whose later keys win.",
  "#",
  "# A row carries a config table only to override a plugin's own default; the rest come from",
  "# the plugin itself. A misspelled key never takes effect quietly: each plugin's configKeys",
  "# declares the keys it reads, and anything extra is named by check:config (reported, never",
  "# blocked).",
  "",
];

export function renderConfig(rows: readonly PluginRow[]): string {
  const lines: string[] = [...HEADER];
  for (const row of rows) {
    lines.push(`[plugins.${row.id}]`);
    if (row.disabled === true) lines.push("disabled = true");
    lines.push(`name = ${tomlValue(row.name)}`);
    if (row.config !== undefined) {
      lines.push(`[plugins.${row.id}.config]`);
      for (const [key, value] of Object.entries(row.config)) lines.push(`${key} = ${tomlValue(value)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/// One package of one row, reachable by name from this profile: Node's own
/// `node_modules` lookup starts at the config file's directory, so the profile
/// owns a link per row and nothing in the config names a machine path.
function linkPackage(dir: string, row: PluginRow, root: string): void {
  let target: string;
  try {
    target = packageDir(row.name, root);
  } catch (error) {
    throw new Error(`maota: the row ${row.id} names ${row.name}: ${messageOf(error)}`);
  }
  const link = join(dir, "node_modules", ...row.name.split("/"));
  mkdirSync(dirname(link), { recursive: true });
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`maota: ${link} already exists and is not a link; move it, then boot again`);
    }
    let current: string | null = null;
    try {
      current = realpathSync(link);
    } catch {
      current = null;
    }
    if (current === realpathSync(target)) return;
    rmdirSync(link);
  }
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

export async function ensureProfile(home: string, profile: string = DEFAULT_PROFILE, root: string = repoRoot): Promise<string> {
  const dir = profileDir(home, profile);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) {
    const template = PROFILE_TEMPLATES[profile];
    writeFileSync(
      manifest,
      JSON.stringify(
        { name: `maota-profile-${profile}`, private: true, maota: { profile: { bundles: [...(template?.bundles ?? [])] } } },
        undefined,
        2,
      ) + "\n",
    );
  }
  const rows = await rowsOfBundles(bundlesOfProfile(dir, profile), root);
  for (const row of rows) linkPackage(dir, row, root);
  const rendered = renderConfig(rows);
  const target = join(dir, GENERATED);
  if (!existsSync(target) || readFileSync(target, "utf8") !== rendered) {
    writeFileSync(target, rendered);
    process.stderr.write(`MaoTa: wrote ${target}\n`);
  }
  return dir;
}

export async function resolveConfigPath(choice: ConfigChoice = {}): Promise<string> {
  const env = choice.env ?? process.env;
  const explicit = choice.explicit ?? env.EGGSHELL_CONFIG;
  if (explicit !== undefined && explicit !== "") return explicit;
  const profile = choice.profile ?? DEFAULT_PROFILE;
  const home = choice.home ?? maotaHome(env);
  const dir = choice.home === undefined ? await ensureProfile(home, profile) : profileDir(home, profile);
  const user = join(dir, USER_LAYER);
  return existsSync(user) ? user : join(dir, GENERATED);
}

export function resolveKernelBin(choice: KernelChoice = {}): string {
  const env = choice.env ?? process.env;
  const root = choice.root ?? repoRoot;
  const installed = choice.installed === undefined ? installedKernel : choice.installed;
  return (
    choice.explicit ??
    env.EGGSHELL_BIN ??
    installed ??
    join(root, "..", "eggshellmod", "target", "debug", "eggshell.exe")
  );
}
