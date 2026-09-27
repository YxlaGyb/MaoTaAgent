import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { maotaHome, projectRoot } from "@maota/fs";
import { blockedContextText, scanContextText } from "@maota/hook-protocol";

export const DEFAULT_MAX_BYTES = 65_536;
const CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const;

export interface InstructionIssue {
  path: string;
  error: string;
}

export interface InstructionBlock {
  id: string;
  path: string;
  text: string;
}

interface Candidate {
  path: string;
  text: string;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function directories(root: string, cwd: string): string[] {
  const out = [root];
  const rest = relative(root, cwd).split(/[\\/]/).filter((part) => part !== "" && part !== ".");
  let current = root;
  for (const part of rest) {
    current = join(current, part);
    out.push(current);
  }
  return out;
}

export function instructionPaths(cwd: string, home = maotaHome()): string[] {
  const paths = [join(home, "AGENTS.md")];
  for (const dir of directories(projectRoot(cwd), resolve(cwd))) {
    for (const name of CANDIDATES) paths.push(join(dir, name));
  }
  return paths;
}

export function fitInstructionBlocks(blocks: readonly InstructionBlock[], maxBytes: number): InstructionBlock[] {
  const kept = [...blocks];
  while (kept.length > 1) {
    const total = kept.reduce((sum, block) => sum + bytes(block.text), 0);
    if (total <= maxBytes) return kept;
    kept.shift();
  }
  const block = kept[0];
  if (block === undefined || bytes(block.text) <= maxBytes) return kept;
  const marker = "\n[...truncated...]";
  const budget = Math.max(0, maxBytes - bytes(marker));
  let text = "";
  let used = 0;
  for (const character of block.text) {
    const size = bytes(character);
    if (used + size > budget) break;
    text += character;
    used += size;
  }
  return [{ ...block, text: text + marker }];
}

export function loadInstructions(
  cwd: string,
  home = maotaHome(),
  maxBytes = DEFAULT_MAX_BYTES,
): { blocks: InstructionBlock[]; issues: InstructionIssue[] } {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const issues: InstructionIssue[] = [];
  for (const path of instructionPaths(cwd, home)) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      issues.push({ path, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const normalized = text.trim();
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ path, text: normalized });
  }

  const blocks = candidates.map((candidate): InstructionBlock => {
    const reasons = scanContextText(candidate.text);
    return {
      id: `agent-instructions:${candidate.path.replace(/\\/g, "/")}`,
      path: candidate.path,
      text: reasons.length === 0 ? candidate.text : blockedContextText(reasons),
    };
  });
  return { blocks: fitInstructionBlocks(blocks, maxBytes), issues };
}