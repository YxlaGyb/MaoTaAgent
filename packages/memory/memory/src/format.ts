import { blockedContextText, scanContextText } from "@maota/hook-protocol";

export const ENTRY_DELIMITER = "\n§\n";
export const DEFAULT_MEMORY_CHARS = 2_200;
export const DEFAULT_USER_CHARS = 1_375;

export type MemoryTarget = "user" | "memory";
export type MemoryAction = "add" | "replace" | "remove";

export interface MemoryOperation {
  action: MemoryAction;
  content?: string;
  old_text?: string;
}

export interface ApplySuccess {
  success: true;
  entries: string[];
  message: string;
}

export interface ApplyFailure {
  success: false;
  error: string;
  entries: string[];
}

export type ApplyResult = ApplySuccess | ApplyFailure;

export function isMemoryTarget(value: unknown): value is MemoryTarget {
  return value === "user" || value === "memory";
}

export function parseEntries(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(ENTRY_DELIMITER)) {
    const entry = piece.trim();
    if (entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

export function entriesText(entries: readonly string[]): string {
  return entries.join(ENTRY_DELIMITER);
}

export function normalizeRaw(raw: string): string {
  return raw.split("\r\n").join("\n").trim();
}

export function hasDrift(raw: string, entries: readonly string[]): boolean {
  return normalizeRaw(raw) !== entriesText(entries);
}

export function usageOf(entries: readonly string[], limit: number): string {
  return `${entriesText(entries).length}/${limit}`;
}

export function usagePercent(entries: readonly string[], limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((entriesText(entries).length / limit) * 100));
}

export function renderBlock(target: MemoryTarget, entries: readonly string[], limit: number): string {
  const title = target === "user" ? "USER PROFILE (who the user is)" : "MEMORY (your personal notes)";
  const separator = "=".repeat(46);
  return `${separator}\n${title} [${usagePercent(entries, limit)}%, ${usageOf(entries, limit)} chars]\n${separator}\n${entriesText(entries)}`;
}

export function sanitizeEntry(entry: string): string {
  const reasons = scanContextText(entry);
  return reasons.length === 0 ? entry : blockedContextText(reasons);
}

export function matchIndex(entries: readonly string[], oldText: string): { index: number } | { error: string } {
  if (oldText.trim() === "") return { error: "old_text must not be blank" };
  const exact = entries.findIndex((entry) => entry === oldText);
  if (exact >= 0) return { index: exact };
  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.includes(oldText));
  if (matches.length === 0) return { error: `no memory entry contains ${JSON.stringify(oldText)}` };
  if (new Set(matches.map((item) => item.entry)).size > 1) {
    return { error: `old_text ${JSON.stringify(oldText)} matches more than one entry` };
  }
  return { index: matches[0]!.index };
}

export function readOperations(value: unknown): { operations: MemoryOperation[] } | { error: string } {
  const input = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (Array.isArray(input.operations)) {
    if (input.operations.length === 0) return { error: "operations must not be empty" };
    const operations: MemoryOperation[] = [];
    for (const [index, raw] of input.operations.entries()) {
      const item = raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
      if (item === null) return { error: `operations[${index}] must be an object` };
      const action = item.action;
      if (action !== "add" && action !== "replace" && action !== "remove") {
        return { error: `operations[${index}].action must be add, replace or remove` };
      }
      const content = item.content === undefined ? undefined : item.content;
      const oldText = item.old_text === undefined ? undefined : item.old_text;
      if (content !== undefined && typeof content !== "string") {
        return { error: `operations[${index}].content must be a string` };
      }
      if (oldText !== undefined && typeof oldText !== "string") {
        return { error: `operations[${index}].old_text must be a string` };
      }
      operations.push({
        action,
        ...(content === undefined ? {} : { content }),
        ...(oldText === undefined ? {} : { old_text: oldText }),
      });
    }
    return { operations };
  }

  const action = input.action;
  if (action !== "add" && action !== "replace" && action !== "remove") {
    return { error: "action must be add, replace or remove when operations is not used" };
  }
  const content = input.content;
  const oldText = input.old_text;
  if (content !== undefined && typeof content !== "string") return { error: "content must be a string" };
  if (oldText !== undefined && typeof oldText !== "string") return { error: "old_text must be a string" };
  return {
    operations: [
      {
        action,
        ...(content === undefined ? {} : { content }),
        ...(oldText === undefined ? {} : { old_text: oldText }),
      },
    ],
  };
}

export function applyOperations(
  current: readonly string[],
  operations: readonly MemoryOperation[],
  limit: number,
): ApplyResult {
  const entries = [...current];
  let message = "";
  for (const operation of operations) {
    if (operation.action === "add" || operation.action === "replace") {
      const content = operation.content?.trim() ?? "";
      if (content === "") return { success: false, error: `content is required for ${operation.action}`, entries };
      const threats = scanContextText(content);
      if (threats.length > 0) {
        return { success: false, error: `refused unsafe memory content: ${threats.join(", ")}`, entries };
      }
      if (operation.action === "add") {
        if (entries.includes(content)) return { success: false, error: "that memory entry is already stored", entries };
        entries.push(content);
        message = "memory entry added";
      } else {
        const found = matchIndex(entries, operation.old_text ?? "");
        if ("error" in found) return { success: false, error: found.error, entries };
        entries[found.index] = content;
        message = "memory entry replaced";
      }
    } else {
      const found = matchIndex(entries, operation.old_text ?? "");
      if ("error" in found) return { success: false, error: found.error, entries };
      entries.splice(found.index, 1);
      message = "memory entry removed";
    }
  }
  if (entriesText(entries).length > limit) {
    return {
      success: false,
      error: `memory is ${entriesText(entries).length}/${limit} chars after this change; consolidate or remove entries and retry`,
      entries,
    };
  }
  return { success: true, entries, message: message || "memory updated" };
}