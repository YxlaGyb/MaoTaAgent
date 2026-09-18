import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { kernel as installedKernel } from "eggshell-kernel";

export const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
export const defaultConfig = join(import.meta.dirname, "..", "eggshell.default.toml");

export interface ConfigChoice {
  explicit?: string | undefined;
  env?: NodeJS.ProcessEnv;
  root?: string;
}

export interface KernelChoice {
  explicit?: string | undefined;
  env?: NodeJS.ProcessEnv;
  installed?: string | null;
  root?: string;
}

export function maotaHome(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.MAOTA_HOME;
  return named !== undefined && named !== "" ? named : join(homedir(), ".maota");
}

export function writeDefaultConfig(home: string): string {
  const target = join(home, "eggshell.toml");
  if (existsSync(target)) return target;
  const body = readFileSync(defaultConfig, "utf8").replaceAll("{{repo}}", repoRoot.replaceAll("\\", "/"));
  mkdirSync(home, { recursive: true });
  writeFileSync(target, body);
  process.stderr.write(`MaoTa: wrote ${target}\n`);
  return target;
}

export function resolveConfigPath(choice: ConfigChoice = {}): string {
  const env = choice.env ?? process.env;
  const explicit = choice.explicit ?? env.EGGSHELL_CONFIG;
  if (explicit !== undefined && explicit !== "") return explicit;
  const home = choice.root ?? maotaHome(env);
  const local = join(home, "eggshell.local.toml");
  if (existsSync(local)) return local;
  return choice.root === undefined ? writeDefaultConfig(home) : join(home, "eggshell.toml");
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