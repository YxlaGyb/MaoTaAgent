import { existsSync } from "node:fs";
import { join } from "node:path";

import { kernel as installedKernel } from "eggshell-kernel";

export const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

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

export function resolveConfigPath(choice: ConfigChoice = {}): string {
  const env = choice.env ?? process.env;
  const root = choice.root ?? repoRoot;
  const explicit = choice.explicit ?? env.EGGSHELL_CONFIG;
  if (explicit !== undefined && explicit !== "") return explicit;
  const local = join(root, "eggshell.local.toml");
  return existsSync(local) ? local : join(root, "eggshell.toml");
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
