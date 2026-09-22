import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { patternToRegExp } from "@maota/plugin-kit";
import type { HookContribution, HookEvent, HookReply } from "@maota/hook-protocol";

/// A hook that is a command rather than a plugin: what a skill brings with it,
/// and what a profile lists under `command_hooks`. It is the same contract the
/// wider hook ecosystem uses, so a script written for it runs here unchanged.
export interface CommandHook {
  event: string;
  command: string;
  matcher?: string;
  timeout_ms?: number;
  /// Which registration owns it, so a scope can be withdrawn in one call.
  scope: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

function matches(hook: CommandHook, event: HookEvent, payload: unknown): boolean {
  if (hook.event !== event) return false;
  const matcher = hook.matcher?.trim();
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  const subject = subjectOf(event, payload);
  if (subject === null) return true;
  return new RegExp(patternToRegExp(matcher)).test(subject);
}

/// What a matcher matches: a tool hook compares tool names, and any other event
/// has nothing narrower than the event itself, so it does not filter.
function subjectOf(event: HookEvent, payload: unknown): string | null {
  if (event !== "PreToolUse" && event !== "PostToolUse") return null;
  const tool = (payload as { tool?: unknown } | null)?.tool;
  return typeof tool === "string" ? tool : null;
}

function auditPath(): string {
  const home = process.env.MAOTA_HOME;
  const base = home !== undefined && home.trim() !== "" ? home : join(homedir(), ".maota");
  return join(base, "audit", "hooks.jsonl");
}

/// Every command hook that ran leaves one line, whatever it answered, because
/// the point of an audit trail is the attempts and not only the refusals.
function audit(record: Record<string, unknown>): void {
  try {
    const path = auditPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, { encoding: "utf8" });
  } catch {
    // An audit trail that cannot be written must not change what a run does.
  }
}

interface Answer {
  reply: HookReply | null;
  note: string;
  exit: number | null;
  ms: number;
}

async function ask(hook: CommandHook, event: HookEvent, payload: unknown, signal: AbortSignal): Promise<Answer> {
  const started = Date.now();
  const timeout = hook.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  return await new Promise<Answer>((resolve) => {
    let settled = false;
    const done = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(answer);
    };
    const child = spawn(hook.command, {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", () => undefined);
    child.on("error", (error: Error) => done({ reply: null, note: `could not run: ${error.message}`, exit: null, ms: Date.now() - started }));
    child.on("close", (code: number | null) => {
      const reply = parseReply(out);
      done({
        reply,
        note: reply === null ? `answered nothing readable (exit ${String(code)})` : "answered",
        exit: code,
        ms: Date.now() - started,
      });
    });
    const onAbort = (): void => {
      child.kill();
      done({ reply: null, note: "aborted", exit: null, ms: Date.now() - started });
    };
    const timer = setTimeout(() => {
      child.kill();
      done({ reply: null, note: `timed out after ${timeout}ms`, exit: null, ms: Date.now() - started });
    }, timeout);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      child.stdin.end(JSON.stringify({ event, payload }));
    } catch {
      done({ reply: null, note: "could not be handed the event", exit: null, ms: Date.now() - started });
    }
  });
}

/// A hook answers with one JSON object on stdout. Anything else is not an
/// opinion, and an opinion is what the gate acts on, so it is dropped rather
/// than guessed at.
function parseReply(out: string): HookReply | null {
  const trimmed = out.trim();
  if (trimmed === "") return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value as HookReply;
  } catch {
    return null;
  }
}

/// Command hooks run concurrently: each one is a separate process, and a slow
/// script has no reason to hold up the others. Their answers arrive in
/// registration order regardless, so folding stays deterministic.
export async function runCommandHooks(
  hooks: readonly CommandHook[],
  event: HookEvent,
  payload: unknown,
  signal: AbortSignal,
  log: (level: string, message: string, fields?: Record<string, unknown>) => void,
): Promise<HookContribution[]> {
  const matched = hooks.filter((hook) => matches(hook, event, payload));
  if (matched.length === 0) return [];
  const answers = await Promise.all(matched.map((hook) => ask(hook, event, payload, signal)));
  const contributions: HookContribution[] = [];
  matched.forEach((hook, index) => {
    const answer = answers[index] as Answer;
    audit({
      event,
      scope: hook.scope,
      command: hook.command,
      exit: answer.exit,
      ms: answer.ms,
      note: answer.note,
      decision: answer.reply?.decision ?? null,
      tool: (payload as { tool?: unknown } | null)?.tool ?? null,
    });
    if (answer.reply === null) {
      log("warn", `hook command ${JSON.stringify(hook.command)} ${answer.note} on ${event}`, { scope: hook.scope });
      return;
    }
    contributions.push({ source: `hook:${hook.scope}`, reply: answer.reply });
  });
  return contributions;
}
