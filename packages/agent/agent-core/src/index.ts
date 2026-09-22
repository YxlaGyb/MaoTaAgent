#!/usr/bin/env node
import { CallError, packageVersion, runPlugin, type Call, type Channel, type Definition, type Wiring } from "@maota/plugin-kit";
import {
  asText,
  runLoop,
  sourcedMessages,
  type ChatDelta,
  type LoopEvent,
  type LoopOutcome,
  type LoopState,
  type Message,
  type PostToolDecision,
  type PreToolDecision,
  type SourcedText,
  type StopDecision,
  type ToolCall,
  type ToolSpec,
} from "@maota/agent-loop";
import type { HookEvent, HookOutcome } from "@maota/hook-protocol";
import { catalogMessage, lastCatalogEntries, sameCatalog, touchedPaths, type CatalogEntry } from "./catalog.ts";
import { compactMessage, continueNote, foldCount, foldRequest, historyChars } from "./compact.ts";
import { narrow, readRunControl, withoutControl, type RunControl } from "./control.ts";
import { systemPrompt } from "./prompt.ts";
import {
  hostValue,
  injectHostArgs,
  readToolList,
  stripHostArgs,
  type HostValues,
} from "./tools.ts";

export const LEVELS = ["off", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export interface LevelSetting {
  model?: string;
  tools: boolean;
}

const DEFAULTS = {
  max_steps: 8,
  max_parallel_tools: 4,
  compact_after_chars: 120_000,
  compact_keep_messages: 12,
  max_depth: 3,
  system:
    "You are MaoTa's coding assistant, running on Windows. Use read, glob and edit for files, " +
    "and pwsh to run commands; do not guess, and do not reach for Unix commands such as tail " +
    "or sed. Answer in the user's language, briefly.",
  thinking: {} as Partial<Record<Level, LevelSetting>>,
};

let settings = { ...DEFAULTS };

/// The thinking level and model of every run that is in flight, keyed by the
/// session it is serving, so a subagent the run spawns inherits them: the loop
/// keeps no other link back to its parent.
const active = new Map<string, LevelSetting>();

/// How deep the run that owns a session is. `active` answers "what may this
/// child do", this answers "how many delegations away is it", and both are
/// cleared when the run that wrote them ends.
const depths = new Map<string, number>();

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function readLevel(value: unknown): Level {
  if (value === undefined || value === null || value === "") return "off";
  if (!isLevel(value)) {
    throw new CallError(-32602, `thinking must be one of ${LEVELS.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function readThinking(value: unknown): Partial<Record<Level, LevelSetting>> {
  const out: Partial<Record<Level, LevelSetting>> = {};
  if (value === null || typeof value !== "object") return out;
  for (const level of LEVELS) {
    const raw = (value as Record<string, unknown>)[level];
    if (typeof raw === "string") {
      if (raw !== "") out[level] = { model: raw, tools: true };
    } else if (raw !== null && typeof raw === "object") {
      const table = raw as { model?: unknown; tools?: unknown };
      out[level] = {
        ...(typeof table.model === "string" && table.model !== "" ? { model: table.model } : {}),
        tools: table.tools !== false,
      };
    }
  }
  return out;
}

export function resolveLevel(thinking: Partial<Record<Level, LevelSetting>>, level: Level): LevelSetting {
  return thinking[level] ?? { tools: true };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function titleOf(text: unknown): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const all = [...segmenter.segment(flat)].map((piece) => piece.segment);
  return all.length > 30 ? `${all.slice(0, 30).join("")}…` : flat;
}

export interface SubagentOrigin {
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

interface SubagentRef {
  subagent_id: string;
  parent_session_id: string;
  parent_call_id: string | null;
  type: string;
  description: string;
}

/// `origin` turns a run into a subagent: a fresh conversation, spawned by the
/// tool call it names, that keeps the identity of the parent it serves.
function readOrigin(value: unknown): SubagentOrigin | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, `origin must be an object, got ${JSON.stringify(value)}`);
  }
  const raw = value as Record<string, unknown>;
  const parent = raw.parent_session_id;
  if (typeof parent !== "string" || parent === "") {
    throw new CallError(
      -32602,
      `origin.parent_session_id must name the session that spawned this run, got ${JSON.stringify(parent)}`,
    );
  }
  const text = (name: string): string | null => {
    const found = raw[name];
    if (found === undefined || found === null) return null;
    if (typeof found !== "string") {
      throw new CallError(-32602, `origin.${name} must be a string, got ${JSON.stringify(found)}`);
    }
    return found;
  };
  return {
    parent_session_id: parent,
    parent_call_id: text("parent_call_id"),
    type: text("type") ?? "general",
    description: text("description") ?? "",
  };
}

function readSystem(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CallError(-32602, `system must be a string, got ${JSON.stringify(value)}`);
  return value.trim() === "" ? undefined : value;
}

function readNames(value: unknown, name: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new CallError(-32602, `${name} must be an array of tool names`);
  const names = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  if (names.length !== value.length) throw new CallError(-32602, `${name} must hold non-empty tool names`);
  return names;
}

function readSteps(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new CallError(-32602, `max_steps must be a positive whole number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function readDepth(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CallError(-32602, `depth must be a whole number of delegations, got ${JSON.stringify(value)}`);
  }
  return value;
}

/// A bus event is a broadcast a subscriber may not be there to hear, and a lost
/// one costs nothing: the run itself is the record.
function announce(channel: Channel, topic: string, payload: unknown): void {
  void channel.publish(topic, payload).catch(() => undefined);
}

/// What a run can honestly claim to have done when it never returned an
/// outcome: the assistant messages it already has are the calls it started.
function startedCalls(messages: readonly Message[]): number {
  return messages.filter((message) => message.role === "assistant").length;
}

async function classifyTool(
  ctx: Call,
  spec: ToolSpec | undefined,
  call: ToolCall,
  host: HostValues,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const reply = (await ctx.channel.call(
      "tools",
      "classify",
      { name: call.name, args: injectHostArgs(spec, call.args, host) },
      { signal },
    )) as { safe?: unknown } | null;
    return reply?.safe === true;
  } catch {
    return false;
  }
}

async function listTools(ctx: Call): Promise<ToolSpec[]> {
  return readToolList(await ctx.channel.call("tools", "list", {}, { signal: ctx.signal }));
}

function readCatalog(reply: unknown): { complete: boolean; entries: CatalogEntry[]; text: string } | null {
  if (reply === null || typeof reply !== "object") return null;
  const input = reply as { complete?: unknown; entries?: unknown; text?: unknown };
  if (typeof input.text !== "string" || input.text.trim() === "") return null;
  if (!Array.isArray(input.entries)) return null;
  const entries: CatalogEntry[] = [];
  for (const raw of input.entries) {
    if (raw === null || typeof raw !== "object") return null;
    const entry = raw as { name?: unknown; description?: unknown };
    if (typeof entry.name !== "string" || entry.name === "" || typeof entry.description !== "string") return null;
    entries.push({ name: entry.name, description: entry.description });
  }
  return { complete: input.complete === true, entries, text: input.text };
}

/// The catalog is the cheap half of the two level load, and it is durable: the
/// newest note in the history is what the model already read, so a turn that
/// would send the same lines sends nothing, a turn whose catalog moved appends a
/// replacement, and an incomplete read never rewrites the model's view.
async function catalogNote(
  ctx: Call,
  history: readonly Message[],
  cwd: string | null,
  touched: readonly string[],
): Promise<Message | null> {
  if (!skillsAvailable) return null;
  let reply: unknown;
  try {
    reply = await ctx.channel.call("skill", "catalog", { cwd: cwd ?? "", touched }, { signal: ctx.signal });
  } catch (error) {
    ctx.channel.log("warn", "agent: the skill catalog could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const catalog = readCatalog(reply);
  if (catalog === null) {
    ctx.channel.log("warn", "agent: the skill catalog came back unreadable");
    return null;
  }
  if (!catalog.complete) return null;
  const previous = lastCatalogEntries(history);
  if (previous !== null && sameCatalog(previous, catalog.entries)) return null;
  if (previous === null && catalog.entries.length === 0) return null;
  return catalogMessage(catalog.text, catalog.entries, previous);
}

/// The policy is read so the prompt can state it, and a deployment without a
/// permission capability simply says nothing about approval.
async function approvalMode(ctx: Call, sessionId: string, cwd: string): Promise<string | null> {
  try {
    const reply = (await ctx.channel.call(
      "permission",
      "policy",
      { session_id: sessionId, cwd },
      { signal: ctx.signal },
    )) as { mode?: unknown } | null;
    return typeof reply?.mode === "string" ? reply.mode : null;
  } catch {
    return null;
  }
}

let hooksAvailable = false;

/// The skill registry is optional too: a deployment without it simply has no
/// catalog, and asking a capability nobody provides would fail every turn.
let skillsAvailable = false;

/// The label a post-tool refusal carries once it becomes context: the engine
/// folds the reasons of several hooks into one, so the message names the event
/// they answered rather than any single hook.
const DENIED = "hook:PostToolUse";

/// The engine answers in the hook dialect while the loop consumes its own
/// decision shapes. This file is the only place that knows both, so every hook
/// field is mapped here and a field this seam has no use for is dropped rather
/// than handed on.
function asPreTool(outcome: HookOutcome): PreToolDecision {
  // `ask` is not a decision this loop knows: it is settled against the
  // permission layer before it gets here, so only a verdict travels on.
  const decision = outcome.decision === "ask" ? undefined : outcome.decision;
  return {
    ...(decision === undefined ? {} : { decision }),
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    ...(outcome.args === undefined ? {} : { args: outcome.args }),
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
  };
}

/// A refusal after the fact is read as a request to stop as well, since this
/// seam has no other way to say no; its reason rides along as context, so the
/// model learns why the round ended.
function asPostTool(outcome: HookOutcome): PostToolDecision {
  const context = [...(outcome.context ?? [])];
  if (outcome.decision === "deny" && outcome.reason !== undefined) context.push({ source: DENIED, text: outcome.reason });
  return {
    ...(context.length === 0 ? {} : { context }),
    ...(outcome.output === undefined ? {} : { output: outcome.output }),
    ...(outcome.preventContinuation === true || outcome.decision === "deny" ? { halt: true } : {}),
  };
}

function asStop(outcome: HookOutcome): StopDecision {
  return {
    ...(outcome.context === undefined ? {} : { context: outcome.context }),
    ...(outcome.steer === undefined ? {} : { steer: outcome.steer }),
  };
}

function hasOpinion(outcome: HookOutcome): boolean {
  return (
    outcome.decision !== undefined ||
    outcome.reason !== undefined ||
    outcome.args !== undefined ||
    outcome.context !== undefined ||
    outcome.output !== undefined ||
    outcome.preventContinuation !== undefined ||
    outcome.steer !== undefined
  );
}

/// A deployment without the engine has no hooks, and one that cannot answer
/// loses only its opinion, never the turn: a hook sits over a gate that already
/// fails closed, so it must never become the reason a run stops.
async function triggerHook(ctx: Call, event: HookEvent, payload: unknown): Promise<HookOutcome> {
  if (!hooksAvailable) return {};
  try {
    const reply = (await ctx.channel.call("hooks", "trigger", { event, payload }, { signal: ctx.signal })) as
      | HookOutcome
      | null;
    return reply ?? {};
  } catch (error) {
    ctx.channel.log("warn", `hooks.trigger ${event} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function seam<T>(
  ctx: Call,
  event: HookEvent,
  payload: unknown,
  map: (outcome: HookOutcome) => T,
): Promise<T | null> {
  const outcome = await triggerHook(ctx, event, payload);
  return hasOpinion(outcome) ? map(outcome) : null;
}

/// The one seam a question can come out of: a hook that answers `ask` hands the
/// call to the permission layer, and that answer becomes the decision. A
/// refusal is final and is never asked about, and an `ask` with nobody to ask
/// is a refusal, because a question must not quietly turn into a yes.
async function preToolUse(
  ctx: Call,
  payload: unknown,
  tool: string,
  target: { session_id: string; cwd: string | null },
): Promise<PreToolDecision | null> {
  const outcome = await triggerHook(ctx, "PreToolUse", payload);
  if (!hasOpinion(outcome)) return null;
  if (outcome.decision !== "ask") return asPreTool(outcome);
  const allowed = await askPermission(ctx, tool, target, outcome.reason);
  return asPreTool({ ...outcome, decision: allowed ? "allow" : "deny" });
}

async function askPermission(
  ctx: Call,
  tool: string,
  target: { session_id: string; cwd: string | null },
  reason: string | undefined,
): Promise<boolean> {
  if (ctx.capabilities.permission === undefined) {
    ctx.channel.log("warn", `a hook asked about ${tool} and there is no permission layer to ask`, { tool });
    return false;
  }
  try {
    const reply = (await ctx.channel.call(
      "permission",
      "request",
      { session_id: target.session_id, cwd: target.cwd, tool, ...(reason === undefined ? {} : { reason }) },
      { signal: ctx.signal },
    )) as { outcome?: unknown } | null;
    return reply?.outcome === "allowed-once";
  } catch (error) {
    ctx.channel.log("warn", `permission.request for ${tool} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}


async function loadHistory(ctx: Call, sessionId: string, cwd: string | null): Promise<Message[]> {
  const reply = (await ctx.channel.call(
    "session",
    "load",
    { id: sessionId, cwd: cwd ?? "" },
    { signal: ctx.signal },
  )) as { messages?: Message[] };
  return Array.isArray(reply?.messages) ? reply.messages : [];
}

/// A long history is folded before the turn runs, and the folded form is what
/// gets stored, so the next turn reads a note instead of replaying the day. A
/// summary that could not be written leaves the history alone: losing the turn
/// would be worse than spending the context.
async function foldHistory(
  ctx: Call,
  history: Message[],
  session: { session_id: string; cwd: string | null; subagent: boolean },
  record: (event: HookEvent, payload: unknown) => Promise<void>,
): Promise<void> {
  if (historyChars(history) <= settings.compact_after_chars) return;
  const folded = foldCount(history, settings.compact_keep_messages);
  if (folded < 2) return;
  // Only a fold that is actually about to happen is announced, so a hook that
  // guards or annotates a conversation is not woken on every quiet turn.
  await record("PreCompact", { ...session, messages: folded });
  let summary: string | null = null;
  try {
    const reply = (await ctx.channel.call(
      "api",
      "chat",
      { messages: foldRequest(history.slice(0, folded)) },
      { signal: ctx.signal },
    )) as { message?: { content?: unknown } } | null;
    const content = reply?.message?.content;
    summary = typeof content === "string" && content.trim() !== "" ? content : null;
  } catch (error) {
    ctx.channel.log("warn", "agent: the history could not be folded", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (summary === null) return;
  history.splice(0, folded, compactMessage(summary, folded));
}

async function persist(
  ctx: Call,
  sessionId: string,
  cwd: string | null,
  messages: readonly Message[],
  title: string,
  parent: SubagentOrigin | null,
): Promise<void> {
  await ctx.channel.call(
    "session",
    "save",
    {
      id: sessionId,
      cwd: cwd ?? "",
      title,
      messages,
      ...(parent === null
        ? {}
        : {
            parent: {
              id: parent.parent_session_id,
              cwd: cwd ?? "",
              call_id: parent.parent_call_id ?? "",
              type: parent.type,
              description: parent.description,
            },
          }),
    },
    { signal: ctx.signal },
  );
}

async function chatStream(
  ctx: Call,
  messages: readonly Message[],
  tools: readonly ToolSpec[],
  model: string | undefined,
  signal: AbortSignal,
  delta: (chunk: ChatDelta) => void,
): Promise<Message> {
  const stream = await ctx.channel.stream(
    "api",
    "chat",
    { messages, tools, ...(model === undefined ? {} : { model }) },
    { signal },
  );
  let final: Message | undefined;
  for await (const chunk of stream) {
    if (signal.aborted) break;
    const event = chunk as { type?: unknown; text?: unknown; message?: Message } | null;
    if (event?.type === "delta" && typeof event.text === "string") delta({ text: event.text });
    else if (event?.type === "reasoning" && typeof event.text === "string") delta({ reasoning: event.text });
    else if (event?.type === "message" && event.message) final = event.message;
  }
  if (!final) {
    if (signal.aborted) throw new CallError(-32013, "cancelled");
    throw new CallError(-32603, "api returned no message");
  }
  return final;
}

const VERSION = packageVersion(import.meta.url);

export const definition: Definition = {
  provides: [{ capability: "agent.loop", version: VERSION }],
  configKeys: [
    "max_steps",
    "max_parallel_tools",
    "compact_after_chars",
    "compact_keep_messages",
    "max_depth",
    "system",
    "thinking",
  ],
  requires: [
    { capability: "api", version: "^1" },
    { capability: "tools", version: "^1" },
    { capability: "session", version: "^1" },
    { capability: "skill", version: "^2", optional: true },
    { capability: "permission", version: "^1", optional: true },
    { capability: "hooks", version: "^1", optional: true },
  ],

  setup(wiring) {
    settings = {
      max_steps:
        typeof wiring.config.max_steps === "number" && wiring.config.max_steps > 0
          ? wiring.config.max_steps
          : DEFAULTS.max_steps,
      max_parallel_tools:
        typeof wiring.config.max_parallel_tools === "number" && wiring.config.max_parallel_tools > 0
          ? wiring.config.max_parallel_tools
          : DEFAULTS.max_parallel_tools,
      compact_after_chars:
        typeof wiring.config.compact_after_chars === "number" && wiring.config.compact_after_chars > 0
          ? wiring.config.compact_after_chars
          : DEFAULTS.compact_after_chars,
      compact_keep_messages:
        typeof wiring.config.compact_keep_messages === "number" && wiring.config.compact_keep_messages >= 0
          ? wiring.config.compact_keep_messages
          : DEFAULTS.compact_keep_messages,
      max_depth:
        typeof wiring.config.max_depth === "number" && wiring.config.max_depth >= 0
          ? wiring.config.max_depth
          : DEFAULTS.max_depth,
      system: typeof wiring.config.system === "string" ? wiring.config.system : DEFAULTS.system,
      thinking: readThinking(wiring.config.thinking),
    };
  },

  /// The hook engine is optional by design: a deployment without it simply has
  /// no hooks, and asking a capability nobody provides would keep this plugin
  /// from starting at all.
  start(wiring) {
    hooksAvailable = wiring.capabilities.hooks !== undefined;
    skillsAvailable = wiring.capabilities.skill !== undefined;
    wiring.channel.log("info", `agent: hooks ${hooksAvailable ? "on" : "off"}, skills ${skillsAvailable ? "on" : "off"}`, {
      hooks: hooksAvailable,
      skills: skillsAvailable,
    });
  },

  methods: {
    async run(params, ctx) {
      const stream = ctx.stream;
      if (!stream) throw new CallError(-32602, "agent.loop.run is streaming: pass meta.stream");

      const sessionId = String(params?.session_id ?? "default");
      const cwd = typeof params?.cwd === "string" && params.cwd !== "" ? params.cwd : null;
      const input = typeof params?.input === "string" ? params.input : "";
      const origin = readOrigin(params?.origin);
      const sub = origin !== null;
      const system = readSystem(params?.system);
      const allow = readNames(params?.tools_allow, "tools_allow");
      const deny = readNames(params?.tools_deny, "tools_deny") ?? [];
      const maxSteps = readSteps(params?.max_steps, settings.max_steps);
      const identity = origin?.parent_session_id ?? sessionId;
      const setting: LevelSetting = sub
        ? { ...(active.get(identity) ?? { tools: true }) }
        : resolveLevel(settings.thinking, readLevel(params?.thinking));

      // Depth is a property of the run, not of the tool that started it: a
      // child is one deeper than the run that owns its parent session, and a
      // deployment may say so explicitly instead.
      /// The session this run belongs to, named the way every hook payload
      /// names it: a subagent reports its parent's session and says so.
      const self = { session_id: identity, cwd, subagent: sub };
      /// Text an event the loop has no seam for contributes, written into the
      /// turn as a message of its own. Before that array exists it waits here, so
      /// `SessionStart` and a fold are heard by the same first model call.
      const pending: SourcedText[] = [];
      const record = async (event: HookEvent, payload: unknown): Promise<void> => {
        const outcome = await triggerHook(ctx, event, payload);
        pending.push(...(outcome.context ?? []));
      };
      const flush = (): void => {
        if (pending.length === 0) return;
        messages.push(...sourcedMessages(pending));
        pending.length = 0;
      };
      const depth = readDepth(params?.depth) ?? (sub ? (depths.get(identity) ?? 0) + 1 : 0);
      if (depth > settings.max_depth) {
        stream.push({
          type: "done",
          steps: 0,
          text: `this run is ${depth} delegations deep, and max_depth is ${settings.max_depth}`,
          reason: "refused",
        });
        await record("Notification", {
          ...self,
          text: `this run was refused: it is ${depth} delegations deep, and max_depth is ${settings.max_depth}`,
        });
        return;
      }
      depths.set(sessionId, depth);

      let prompt: PreToolDecision | null = null;
      if (!sub) {
        // Before the tools, the skills, the gate and the model: a refused prompt
        // costs a hook call and nothing else, and it is never written down.
        prompt = await seam(ctx, "UserPromptSubmit", { session_id: sessionId, cwd, input }, asPreTool);
        if (prompt?.decision === "deny") {
          stream.push({ type: "done", steps: 0, text: prompt.reason ?? "", reason: "refused" });
          return;
        }
      }

      await record("SessionStart", { ...self });

      const [available, mode] = await Promise.all([listTools(ctx), approvalMode(ctx, identity, cwd ?? "")]);
      const allowed = (name: string): boolean => (allow === null || allow.includes(name)) && !deny.includes(name);
      const pool = setting.tools ? [...available] : [];
      const declared = pool.filter((tool) => allowed(tool.name));

      /// The tool surface is a live thing: a tool result may narrow it for the
      /// rest of the run, and the model's view, the refusal gate and the loop
      /// all read the same current list rather than three snapshots.
      let narrowed: string[] | null = null;
      let runModel = setting.model;
      let visible = declared;
      let modelTools = visible.map(stripHostArgs);
      let visibleNames = new Set(visible.map((tool) => tool.name));
      const loopTools: ToolSpec[] = [...declared];
      const narrowTo = (keep: readonly string[]): void => {
        narrowed = narrow(narrowed, keep);
        const wanted = new Set(narrowed);
        visible = declared.filter((tool) => wanted.has(tool.name));
        modelTools = visible.map(stripHostArgs);
        visibleNames = new Set(visible.map((tool) => tool.name));
        loopTools.length = 0;
        loopTools.push(...visible);
      };
      const child: SubagentRef | null =
        origin === null
          ? null
          : {
              subagent_id: sessionId,
              parent_session_id: origin.parent_session_id,
              parent_call_id: origin.parent_call_id,
              type: origin.type,
              description: origin.description,
            };

      // A subagent's calls are the parent's calls as far as the rest of the
      // deployment is concerned: the same session, the same `task` call, and a
      // label saying which subagent is asking.
      let touched: string[] = [];
      const host = (callId: string | null): HostValues => ({
        session_cwd: cwd,
        session_id: identity,
        call_id: origin === null ? callId : origin.parent_call_id,
        subagent: child === null ? null : { id: child.subagent_id, type: child.type, description: child.description },
        session_touched: touched,
      });
      const specOf = (name: string): ToolSpec | undefined => declared.find((tool) => tool.name === name);
      const argsOf = (call: ToolCall): unknown => injectHostArgs(specOf(call.name), call.args, host(call.id));
      const hooksFor = (invoked: ToolCall, step: number): Record<string, unknown> => ({
        session_id: identity,
        cwd,
        step,
        tool: invoked.name,
        args: argsOf(invoked),
        call_id: origin === null ? invoked.id : origin.parent_call_id,
        ...(child === null
          ? {}
          : { subagent: { id: child.subagent_id, type: child.type, description: child.description } }),
      });
      // The tool surface is closed at the seam as well as in the listing, so a
      // name the model invented is refused instead of hoped against.
      const refused = (name: string): PreToolDecision => ({
        decision: "deny",
        reason: sub
          ? `the ${name} tool is not available to this subagent`
          : `the ${name} tool is not available in this run`,
      });
      const announceSub = (topic: string, fields: Record<string, unknown>): void => {
        if (child === null) return;
        announce(ctx.channel, topic, { ...child, ...fields });
      };
      /// A delegation announces itself under the same fields at both ends, so
      /// the two events read one payload and only the event name tells them apart.
      const subagentPayload = (): Record<string, unknown> | null =>
        child === null
          ? null
          : {
              session_id: identity,
              cwd,
              subagent_id: child.subagent_id,
              type: child.type,
              description: child.description,
            };

      /// A forked body runs as its own run and only its last words come back:
      /// the instructions it followed and the tools it used are its business,
      /// and the call that asked for it wants a result.
      const runFork = async (invoked: ToolCall, body: string, label: string): Promise<string> => {
        let stream;
        try {
          stream = await ctx.channel.stream(
            "agent.loop",
            "run",
            {
              session_id: `${identity}:${invoked.id}`,
              cwd,
              input: body,
              origin: {
                parent_session_id: identity,
                parent_call_id: invoked.id,
                type: "skill",
                description: label,
              },
              tools_deny: ["skill"],
            },
            { signal: ctx.signal },
          );
        } catch (error) {
          return `the skill body could not be run on its own: ${error instanceof Error ? error.message : String(error)}`;
        }
        let done: { text?: unknown; reason?: unknown } | null = null;
        try {
          for await (const chunk of stream) {
            const event = chunk as { type?: unknown; text?: unknown; reason?: unknown } | null;
            if (event?.type === "done") done = event;
          }
        } catch (error) {
          return `the skill body failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (done === null) return "the skill body ended without a result";
        return typeof done.text === "string" ? done.text : "";
      };

      /// What a tool result asks the run to become, applied in one place for
      /// every tool: nothing here knows what a skill is, so a plan or a policy
      /// plugin can borrow the same channel later.
      const hooksRegistered: string[] = [];
      const applyControl = async (control: RunControl, invoked: ToolCall, output: unknown): Promise<unknown> => {
        const content = withoutControl(output);
        if (control.tools_allow !== undefined) narrowTo(control.tools_allow);
        if (control.model !== undefined) runModel = control.model;
        if (control.hooks !== undefined && hooksAvailable) {
          const scope = `${identity}:${invoked.id}`;
          try {
            await ctx.channel.call("hooks", "register", { scope, hooks: control.hooks }, { signal: ctx.signal });
            hooksRegistered.push(scope);
          } catch (error) {
            ctx.channel.log("warn", "agent: the hooks a tool brought could not be registered", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (control.fork === true) {
          const label = typeof invoked.args === "object" && invoked.args !== null
            ? String((invoked.args as { name?: unknown }).name ?? invoked.name)
            : invoked.name;
          return await runFork(invoked, asText(content), label);
        }
        return content;
      };

      const history: Message[] = sub ? [] : await loadHistory(ctx, sessionId, cwd);
      if (input !== "") history.push({ role: "user", content: input });
      const first = history.find((message) => message.role === "user" && typeof message.content === "string");
      history.push(...sourcedMessages(prompt?.context ?? []));
      touched = touchedPaths(history, new Map(declared.map((tool) => [tool.name, tool])), cwd);

      // The note is read before the fold and written after it, so a catalog
      // that a fold swallowed is still compared against, and the note the model
      // is about to read is never what the fold eats.
      const note = sub ? null : await catalogNote(ctx, history, cwd, touched);
      if (!sub) await foldHistory(ctx, history, self, record);
      if (note !== null) history.push(note);

      const title = origin !== null && origin.description !== "" ? origin.description : titleOf(first?.content);
      await persist(ctx, sessionId, cwd, history, title, origin);

      const messages: Message[] = [
        { role: "system", content: systemPrompt(system ?? settings.system, cwd, mode) },
        ...history,
      ];
      flush();

      const starting = subagentPayload();
      if (starting !== null) {
        await record("SubagentStart", starting);
        flush();
      }
      announceSub("agent.subagent.started", {});
      if (!sub) active.set(sessionId, setting);
      const heartbeat = setInterval(() => stream.push({ type: "tick" }), 10_000);
      let closed = false;
      /// What the run will say it ended with, so `SessionEnd` can be raised from
      /// the one place every ending passes through.
      let ending: { steps: number; reason: string } = { steps: 0, reason: "failed" };
      try {
        let outcome: LoopOutcome | null = null;
        try {
          outcome = await runLoop(
            {
              tools: loopTools,
              max_steps: maxSteps,
              max_parallel: settings.max_parallel_tools,
              chat: async (step) => {
                await record("PreModel", { ...self, step: step.step });
                flush();
                try {
                  const message = await chatStream(
                    ctx,
                    step.state.messages,
                    modelTools,
                    runModel,
                    step.signal,
                    step.delta,
                  );
                  await record("PostModel", { ...self, step: step.step, ok: true });
                  flush();
                  return message;
                } catch (error) {
                  await record("PostModel", { ...self, step: step.step, ok: false });
                  flush();
                  throw error;
                }
              },
              callTool: (invoked, step) =>
                ctx.channel.call(
                  "tools",
                  "call",
                  { name: invoked.name, args: argsOf(invoked) },
                  { signal: step.signal },
                ),
              classify: (invoked, step) =>
                classifyTool(ctx, specOf(invoked.name), invoked, host(invoked.id), step.signal),
              preTool: async (invoked, step) =>
                allowed(invoked.name) && visibleNames.has(invoked.name)
                  ? await preToolUse(ctx, hooksFor(invoked, step.step), invoked.name, self)
                  : refused(invoked.name),
              postTool: async (invoked, outcome, step) => {
                const decision = await seam(
                  ctx,
                  "PostToolUse",
                  { ...hooksFor(invoked, step.step), ok: outcome.ok, output: outcome.output },
                  asPostTool,
                );
                const control = readRunControl(outcome.output);
                if (control === null) return decision;
                const applied = await applyControl(control, invoked, outcome.output);
                return { ...(decision ?? {}), output: applied };
              },
              ...(sub
                ? {}
                : {
                    atStop: (state: LoopState) =>
                      seam(
                        ctx,
                        "Stop",
                        { session_id: sessionId, cwd, steps: state.step, stop_active: state.stopSteered },
                        asStop,
                      ),
                  }),
            },
            messages,
            ctx.signal,
            (event: LoopEvent) => {
              stream.push(event);
              if (event.type === "step") announceSub("agent.subagent.step", { step: event.step });
              else if (event.type === "tool_call") {
                announceSub("agent.subagent.tool_call", { id: event.id, tool: event.tool, args: event.args });
              } else if (event.type === "tool_result") {
                announceSub("agent.subagent.tool_result", {
                  id: event.id,
                  tool: event.tool,
                  ok: event.ok,
                  output: event.output,
                });
              }
            },
          );
        } catch (error) {
          // A model call that failed for good is not a crash of the run: what
          // the turn already holds is saved, and the front end is told why.
          const cancelled = ctx.signal.aborted;
          const reason = cancelled ? "aborted" : "model_error";
          ending = { steps: startedCalls(messages), reason };
          await record("Notification", {
            ...self,
            text: `a turn ended without the model finishing: ${reason}`,
          });
          flush();
          await persist(ctx, sessionId, cwd, messages.slice(1), title, origin);
          stream.push({
            type: "done",
            steps: ending.steps,
            text: cancelled
              ? ""
              : `the model call failed: ${error instanceof Error ? error.message : String(error)}`,
            reason,
          });
        }
        if (outcome !== null) {
          // The ceiling is not a dead end: the turn says where it stopped, and
          // that note is stored with the rest, so the next turn continues.
          if (outcome.reason === "max_steps") messages.push(continueNote(outcome.steps));
          ending = { steps: outcome.steps, reason: outcome.reason };
          const stopping = subagentPayload();
          if (stopping !== null) await record("SubagentStop", stopping);
          flush();
          await persist(ctx, sessionId, cwd, messages.slice(1), title, origin);
          announceSub("agent.subagent.finished", {
            steps: outcome.steps,
            reason: outcome.reason,
            ok: outcome.reason === "completed",
          });
          closed = true;
          stream.push({ type: "done", steps: outcome.steps, text: outcome.text, reason: outcome.reason });
        }
      } finally {
        clearInterval(heartbeat);
        const before = messages.length;
        await record("SessionEnd", { ...self, ...ending });
        const stopping = subagentPayload();
        if (stopping !== null && !closed) await record("SubagentStop", stopping);
        flush();
        // What the last two points said belongs to the turn like everything
        // else, or a hook that only speaks at the end is never heard at all.
        if (messages.length > before) await persist(ctx, sessionId, cwd, messages.slice(1), title, origin);
        if (!sub) active.delete(sessionId);
        depths.delete(sessionId);
        // A hook a tool brought belongs to the run that tool ran in, so it is
        // withdrawn here rather than left to fire on whatever comes next.
        for (const scope of hooksRegistered) {
          try {
            await ctx.channel.call("hooks", "unregister", { scope }, { signal: ctx.signal });
          } catch {
            // The hooks engine will outlive this run by nothing at all if it is
            // gone already, so a failed withdrawal needs no ceremony.
          }
        }
        if (child !== null && !closed) announceSub("agent.subagent.finished", { ok: false, reason: "failed" });
      }
    },

    info() {
      return { levels: [...LEVELS], thinking: settings.thinking };
    },
  },

  async selfCheck() {
    const problems: string[] = [];

    let budget = 0;
    const stalled = await runLoop(
      {
        tools: [],
        max_steps: 2,
        chat: async () => {
          budget += 1;
          return {
            role: "assistant",
            content: null,
            tool_calls: [{ id: `c${budget}`, function: { name: "echo", arguments: "{}" } }],
          };
        },
        callTool: async () => "ok",
      },
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      () => {},
    );
    if (stalled.reason !== "max_steps") problems.push(`a stalled loop ended as ${stalled.reason}, expected max_steps`);
    if (stalled.steps !== 2) problems.push(`a stalled loop took ${stalled.steps} steps, expected 2`);
    if (budget !== 2) problems.push(`a stalled loop called the model ${budget} times, expected 2`);

    const thinking = readThinking({
      low: "deepseek-chat",
      medium: { model: "deepseek-reasoner", tools: false },
      nonsense: "ignored",
    });
    if (Object.keys(thinking).length !== 2) problems.push("unknown level names were kept");
    if (resolveLevel(thinking, "low").model !== "deepseek-chat") problems.push("a bare model name was not read");
    if (!resolveLevel(thinking, "low").tools) problems.push("a bare model name should keep tools on");
    if (resolveLevel(thinking, "medium").tools) problems.push("tools = false was ignored");
    if (resolveLevel(thinking, "high").model !== undefined) problems.push("an unset level invented a model");
    if (!resolveLevel(thinking, "high").tools) problems.push("an unset level should keep tools on");
    if (readLevel(undefined) !== "off") problems.push("the default level is not off");
    try {
      readLevel("deep");
      problems.push("readLevel accepted an unknown level");
    } catch {
    }

    if (titleOf("  a\n\nb  ") !== "a b") problems.push(`titleOf flattened to ${JSON.stringify(titleOf("  a\n\nb  "))}`);
    if (titleOf("x".repeat(40)) !== `${"x".repeat(30)}…`) problems.push("titleOf did not cut at 30 graphemes");
    if (titleOf(undefined) !== "") problems.push("titleOf invented a title");
    const family = titleOf("👨‍👩‍👧‍👦".repeat(40));
    if ([...segmenter.segment(family)].length > 31) problems.push("titleOf split a grapheme cluster");
    if (!family.endsWith("…")) problems.push("titleOf did not cut the long family line");

    if (systemPrompt("base", null, "ask")?.includes("approval: ask") !== true) {
      problems.push("the system prompt did not state the approval policy");
    }
    if (systemPrompt("base", null, null) !== "base") {
      problems.push("the system prompt invented an approval line with no policy");
    }
    if (systemPrompt("base", "E:\\proj").includes("skill")) {
      problems.push("the system prompt carried a skill list");
    }

    const host: HostValues = {
      session_cwd: "E:\\proj",
      session_id: "s1",
      call_id: "c1",
      subagent: null,
      session_touched: [],
    };
    const pwsh: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [{ name: "workdir", source: "session_cwd" }],
    };
    if ((injectHostArgs(pwsh, { command: "ls" }, host) as { workdir?: string }).workdir !== "E:\\proj") {
      problems.push("the session workdir was not injected");
    }
    if ((injectHostArgs(pwsh, { command: "ls", workdir: "D:\\x" }, host) as { workdir?: string }).workdir !== "D:\\x") {
      problems.push("host injection overwrote the model's own workdir");
    }
    const other: ToolSpec = {
      name: "other",
      input_schema: { type: "object", properties: { a: { type: "string" } } },
    };
    if ((injectHostArgs(other, { a: 1 }, host) as { workdir?: unknown }).workdir !== undefined) {
      problems.push("host args were injected into a tool that declares none");
    }
    if (
      (injectHostArgs(pwsh, { command: "ls" }, {
        session_cwd: null,
        session_id: null,
        call_id: null,
        subagent: null,
        session_touched: [],
      }) as {
        workdir?: unknown;
      }).workdir !== undefined
    ) {
      problems.push("host args were injected without a session workdir");
    }
    const gate: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [
        { name: "workdir", source: "session_cwd" },
        { name: "session_id", source: "session_id" },
        { name: "call_id", source: "call_id" },
      ],
    };
    const injected = injectHostArgs(gate, { command: "ls" }, host) as {
      workdir?: string;
      session_id?: string;
      call_id?: string;
    };
    if (injected.session_id !== "s1" || injected.call_id !== "c1" || injected.workdir !== "E:\\proj") {
      problems.push(`the session and call identity were not injected: ${JSON.stringify(injected)}`);
    }
    if (hostValue("elsewhere", host) !== null) problems.push("an unknown host source invented a value");
    if ((stripHostArgs(pwsh) as { host_args?: unknown }).host_args !== undefined) {
      problems.push("host_args leaked into the model visible spec");
    }
    if (stripHostArgs(pwsh).name !== "pwsh") problems.push("stripHostArgs dropped the tool name");

    const subTool: ToolSpec = {
      name: "pwsh",
      input_schema: { type: "object", properties: { command: { type: "string" } } },
      host_args: [
        { name: "session_id", source: "session_id" },
        { name: "call_id", source: "call_id" },
        { name: "subagent", source: "subagent" },
      ],
    };
    const carried = injectHostArgs(subTool, { command: "ls" }, {
      session_cwd: "E:\\proj",
      session_id: "p1",
      call_id: "c1",
      subagent: { id: "sub-3f2a", type: "explore", description: "look" },
    } as HostValues) as { subagent?: { id?: string; type?: string } };
    if (carried.subagent?.id !== "sub-3f2a" || carried.subagent.type !== "explore") {
      problems.push(`the subagent identity was not injected: ${JSON.stringify(carried)}`);
    }
    if ((injectHostArgs(subTool, { command: "ls" }, host) as { subagent?: unknown }).subagent !== undefined) {
      problems.push("a parent's call invented a subagent identity");
    }

    const defaults = readOrigin({ parent_session_id: "p1" });
    if (defaults?.type !== "general" || defaults.description !== "") problems.push("origin defaults drifted");
    if (readOrigin(undefined) !== null) problems.push("an absent origin invented a subagent");

    const published: Array<{ topic: string; payload: Record<string, any> }> = [];
    const calls: Array<{ capability: string; method: string; params: any }> = [];
    const saves: Array<Record<string, any>> = [];
    const listed: ToolSpec[] = [
      { name: "read", description: "read a file", paths: ["file_path"] },
      { name: "write", description: "write a file" },
      { name: "task", description: "ask another agent" },
      { name: "skill", description: "load a skill", host_args: [{ name: "cwd", source: "session_cwd" }] },
    ];
    let historyReply: Message[] = [{ role: "user", content: "earlier" }];
    let catalogReply: unknown = { complete: true, entries: [{ name: "s", description: "d" }], text: "catalog text" };
    let hookAnswer: (params: any) => unknown = () => ({});
    const scripted = (content: string, tool?: string): Message => ({
      role: "assistant",
      content: tool === undefined ? content : null,
      ...(tool === undefined ? {} : { tool_calls: [{ id: `t-${tool}`, function: { name: tool, arguments: "{}" } }] }),
    });
    const harness = (script: readonly Message[], gate?: Promise<void>, failChat = false) => {
      const chat: Array<{ messages: Message[]; tools?: ToolSpec[]; model?: string }> = [];
      const events: LoopEvent[] = [];
      const heard: Array<{ capability: string; method: string; params: any }> = [];
      const sent: typeof published = [];
      const queue = [...script];
      const channel = {
        call: async (capability: string, method: string, params: any) => {
          const record = { capability, method, params };
          calls.push(record);
          heard.push(record);
          if (capability === "tools" && method === "list") return { tools: listed };
          if (capability === "skill" && method === "catalog") return catalogReply;
          if (capability === "permission" && method === "policy") return { mode: "ask" };
          if (capability === "session" && method === "load") return { messages: historyReply };
          if (capability === "session" && method === "save") {
            saves.push(params);
            return {};
          }
          if (capability === "tools" && method === "classify") return { safe: true };
          if (capability === "tools" && method === "call") return "tool output";
          if (capability === "api" && method === "chat") return { message: { role: "assistant", content: "folded note" } };
          if (capability === "hooks" && method === "trigger") return hookAnswer(params);
          throw new Error(`unexpected call ${capability}/${method}`);
        },
        stream: async (_capability: string, _method: string, params: any) => {
          chat.push(params);
          if (gate !== undefined) await gate;
          if (failChat) throw new CallError(-32000, "the upstream broke");
          const message = queue.shift() ?? { role: "assistant", content: "done" };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "message", message };
            },
          };
        },
        publish: async (topic: string, payload: unknown) => {
          const record = { topic, payload: payload as Record<string, any> };
          published.push(record);
          sent.push(record);
        },
        log: () => {},
      };
      const call = {
        channel,
        config: {},
        capabilities: {},
        capability: "agent.loop",
        method: "run",
        caller: "tool-subagent",
        signal: new AbortController().signal,
        stream: { push: (event: LoopEvent) => events.push(event) },
      } as unknown as Call;
      return { call, chat, events, heard, sent };
    };
    const surfaced = (chat: Array<{ tools?: ToolSpec[] }>): string =>
      (chat[0]?.tools ?? []).map((tool) => tool.name).join(",");
    const run = (
      params: Record<string, unknown>,
      script: readonly Message[],
      gate?: Promise<void>,
      failChat = false,
    ) => {
      const made = harness(script, gate, failChat);
      return { ...made, done: Promise.resolve(definition.methods.run?.(params, made.call)) };
    };

    // The registry is what decides whether a catalog exists, so it is announced
    // the way a deployment announces it: through the capability table the kernel
    // passes to start.
    definition.start?.({
      channel: { log: (): void => {} },
      config: {},
      capabilities: { skill: { plugin: "@maota/skill", version: "2.0.0" } },
    } as unknown as Wiring);

    const explore = run(
      {
        session_id: "sub-a",
        cwd: "E:\\proj",
        input: "find where the loader is registered",
        origin: { parent_session_id: "p1", parent_call_id: "c1", type: "explore", description: "look at the loader" },
        system: "you are an explore subagent",
        tools_allow: ["read"],
        tools_deny: ["task"],
        max_steps: 3,
      },
      [scripted("", "write"), scripted("the loader is in graph.rs")],
    );
    await explore.done;
    if (explore.chat.length !== 2) problems.push(`the subagent ran ${explore.chat.length} steps, expected 2`);
    if (surfaced(explore.chat) !== "read") problems.push(`the explore subagent listed ${surfaced(explore.chat)}`);
    const opening = explore.chat[0]?.messages ?? [];
    if (opening[1]?.role !== "user" || opening[1]?.content !== "find where the loader is registered") {
      problems.push(`the subagent opened with ${JSON.stringify(opening.slice(0, 3))}`);
    }
    const brief = explore.chat[0]?.messages[0]?.content ?? "";
    if (!brief.startsWith("you are an explore subagent")) {
      problems.push("the subagent kept the deployment system prompt over its own");
    }
    if (!brief.includes("working directory: E:\\proj") || !brief.includes("approval: ask")) {
      problems.push(`the subagent prompt lost its place and policy: ${JSON.stringify(brief)}`);
    }
    if (explore.heard.some((item) => item.capability === "session" && item.method === "load")) {
      problems.push("the subagent read the history it was meant to start without");
    }
    if (explore.heard.some((item) => item.capability === "skill")) problems.push("a subagent was offered skills");
    if (explore.heard.some((item) => item.capability === "tools" && item.method === "call")) {
      problems.push("a tool the subagent does not have was still run");
    }
    const blocked = explore.events.find((event) => event.type === "tool_result") as
      | { ok?: boolean; output?: unknown }
      | undefined;
    if (blocked === undefined || blocked.ok !== false || !String(blocked.output).includes("not available to this subagent")) {
      problems.push(`a tool outside the subagent surface came out as ${JSON.stringify(blocked)}`);
    }
    const saved = saves.at(-1) ?? null;
    if (saved?.parent?.id !== "p1" || saved.parent.call_id !== "c1" || saved.parent.type !== "explore") {
      problems.push(`the subagent session was saved as ${JSON.stringify(saved?.parent)}`);
    }
    if (saved?.title !== "look at the loader") problems.push(`the subagent session was titled ${JSON.stringify(saved?.title)}`);
    if (((saved?.messages ?? []) as Message[]).some((message) => message.name === "skill-catalog")) {
      problems.push("a subagent session was given a catalog note");
    }
    const topics = explore.sent.map((item) => item.topic).join(",");
    if (
      topics !==
      "agent.subagent.started,agent.subagent.step,agent.subagent.tool_call,agent.subagent.tool_result," +
        "agent.subagent.step,agent.subagent.finished"
    ) {
      problems.push(`the subagent published ${JSON.stringify(topics)}`);
    }
    const head = explore.sent[0]?.payload ?? {};
    if (head.subagent_id !== "sub-a" || head.parent_session_id !== "p1" || head.parent_call_id !== "c1") {
      problems.push(`the first subagent event carried ${JSON.stringify(head)}`);
    }
    if (explore.sent.some((item) => item.payload.description !== "look at the loader")) {
      problems.push("a subagent event lost the description");
    }

    const general = run(
      {
        session_id: "sub-b",
        cwd: "E:\\proj",
        input: "summarise the tree",
        origin: { parent_session_id: "p1", parent_call_id: "c2", type: "general", description: "summarise" },
        tools_deny: ["task", "skill"],
      },
      [scripted("", "task"), scripted("done")],
    );
    await general.done;
    if (surfaced(general.chat) !== "read,write") problems.push(`the general subagent listed ${surfaced(general.chat)}`);
    if (general.heard.some((item) => item.capability === "tools" && item.method === "call")) {
      problems.push("the tool that spawns subagents ran inside a subagent");
    }
    if (general.heard.some((item) => item.capability === "skill")) {
      problems.push("a subagent asked for a skill catalog");
    }

    historyReply = [
      { role: "user", content: "earlier" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "h1", function: { name: "read", arguments: JSON.stringify({ file_path: "packages/agent/x.ts" }) } },
        ],
      },
    ];
    definition.setup?.({ channel: undefined, config: { thinking: { low: "m-low" } }, capabilities: {} } as unknown as Wiring);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parent = run({ session_id: "p1", cwd: "E:\\proj", input: "hi", thinking: "low" }, [scripted("parent done")], held);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (surfaced(parent.chat) !== "read,write,task,skill") {
      problems.push(`the parent listed ${surfaced(parent.chat)}`);
    }
    const inherited = run(
      {
        session_id: "sub-c",
        cwd: "E:\\proj",
        input: "child",
        origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
      },
      [scripted("child done")],
    );
    await inherited.done;
    if (inherited.chat[0]?.model !== "m-low") {
      problems.push(`a subagent ran on model ${JSON.stringify(inherited.chat[0]?.model)}, expected the parent's`);
    }
    if (surfaced(inherited.chat) !== "read,write,task,skill") {
      problems.push(`the skill tool stopped being an ordinary tool: ${surfaced(inherited.chat)}`);
    }
    release();
    await parent.done;
    if (!parent.heard.some((item) => item.capability === "session" && item.method === "load")) {
      problems.push("the parent skipped its own history");
    }

    const noteOf = (entries: Array<{ name: string; description: string }>, update = false): Message => ({
      role: "user",
      name: "skill-catalog",
      content: "catalog text",
      source: { kind: "skill-catalog", ...(update ? { update: true } : {}), entries },
    });
    const catalogNotes = (saved: Record<string, any> | undefined): Message[] =>
      ((saved?.messages ?? []) as Message[]).filter((message) => message.name === "skill-catalog");
    const entries = [{ name: "s", description: "d" }];

    const parentSave = saves.at(-1);
    const parentNotes = catalogNotes(parentSave);
    if (parentNotes.length !== 1) problems.push(`the parent kept ${parentNotes.length} catalog notes, expected 1`);
    const note = parentNotes[0]?.source as { kind?: unknown; entries?: unknown; update?: unknown } | undefined;
    if (note?.kind !== "skill-catalog") problems.push(`the catalog note carried ${JSON.stringify(note)}`);
    if ((note?.entries as unknown[] | undefined)?.length !== 1) problems.push("the catalog note lost its entries");
    if (note?.update !== undefined) problems.push("a first catalog note claimed to be an update");
    const askedFor = parent.heard.find((item) => item.capability === "skill");
    if (askedFor?.method !== "catalog") problems.push(`the parent asked the registry for ${String(askedFor?.method)}`);
    if ((askedFor?.params?.touched ?? []).includes("E:\\proj\\packages\\agent\\x.ts") !== true) {
      problems.push(`the catalog call carried ${JSON.stringify(askedFor?.params?.touched)}`);
    }
    if (askedFor?.params?.cwd !== "E:\\proj") {
      problems.push(`the catalog call carried cwd ${String(askedFor?.params?.cwd)}`);
    }

    historyReply = [noteOf(entries)];
    const steady = run({ session_id: "p2", cwd: "E:\\proj", input: "again" }, [scripted("ok")]);
    await steady.done;
    if (catalogNotes(saves.at(-1)).length !== 1) {
      problems.push(`an unchanged catalog appended ${catalogNotes(saves.at(-1)).length - 1} notes`);
    }

    catalogReply = { complete: true, entries: [{ name: "s", description: "moved" }], text: "catalog text two" };
    const moved = run({ session_id: "p3", cwd: "E:\\proj", input: "again" }, [scripted("ok")]);
    await moved.done;
    const movedNotes = catalogNotes(saves.at(-1));
    if (movedNotes.length !== 2) problems.push(`a moved catalog kept ${movedNotes.length} notes`);
    if ((movedNotes[1]?.source as { update?: unknown } | undefined)?.update !== true) {
      problems.push("a replacement note was not marked as an update");
    }

    catalogReply = { complete: false, entries: [{ name: "s", description: "moved" }], text: "catalog text three" };
    historyReply = [noteOf(entries)];
    const partial = run({ session_id: "p4", cwd: "E:\\proj", input: "again" }, [scripted("ok")]);
    await partial.done;
    if (catalogNotes(saves.at(-1)).length !== 1) {
      problems.push("an incomplete catalog read rewrote the model's view");
    }

    catalogReply = { complete: true, entries: [], text: "<available_skills>\n</available_skills>" };
    const emptied = run({ session_id: "p5", cwd: "E:\\proj", input: "again" }, [scripted("ok")]);
    await emptied.done;
    const emptiedNotes = catalogNotes(saves.at(-1));
    if (emptiedNotes.length !== 2) problems.push("an emptied catalog did not replace the previous note");
    if (((emptiedNotes[1]?.source as { entries?: unknown[] } | undefined)?.entries ?? [null]).length !== 0) {
      problems.push("the empty replacement carried entries");
    }
    const orphan = run(
      {
        session_id: "sub-d",
        cwd: "E:\\proj",
        input: "child",
        origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
      },
      [scripted("child done")],
    );
    await orphan.done;
    if (orphan.chat[0]?.model !== undefined) {
      problems.push(`a subagent outlived its parent's level: ${JSON.stringify(orphan.chat[0]?.model)}`);
    }

    for (const [bad, why] of [
      [{ session_id: "s", origin: {} }, "an origin without a parent"],
      [{ session_id: "s", origin: { parent_session_id: "" } }, "a blank parent session"],
      [{ session_id: "s", origin: 7 }, "a non-object origin"],
      [{ session_id: "s", tools_allow: "read" }, "a non-array allow list"],
      [{ session_id: "s", tools_allow: ["read", 7] }, "an allow list with a non-name"],
      [{ session_id: "s", max_steps: 0 }, "a zero step budget"],
      [{ session_id: "s", system: 7 }, "a non-string system prompt"],
    ] as Array<[Record<string, unknown>, string]>) {
      try {
        await run(bad, []).done;
        problems.push(`run accepted ${why}`);
      } catch {
      }
    }

    if (hasOpinion({})) problems.push("an empty hook outcome counted as an opinion");
    if (!hasOpinion({ context: [] })) problems.push("a bare context is still an opinion");
    if ("steer" in asPreTool({ decision: "deny", reason: "no", steer: "again" })) {
      problems.push("a pre-tool decision kept a field its seam does not consume");
    }
    const refused = asPostTool({ decision: "deny", reason: "no" });
    if (refused.halt !== true) problems.push("a post-tool refusal did not end the round");
    if ((refused.context ?? []).map((note) => `${note.source}:${note.text}`).join(",") !== `${DENIED}:no`) {
      problems.push(`a post-tool refusal came out as ${JSON.stringify(refused.context)}`);
    }
    const steering = asStop({ steer: "again", context: [{ source: "hook:x", text: "t" }] });
    if (steering.steer !== "again" || steering.context?.length !== 1) problems.push("a stop decision drifted");

    let engine = 0;
    const logged: string[] = [];
    const fakeEngine = (reply: unknown, fail = false): Wiring =>
      ({
        config: {},
        capabilities: { hooks: { plugin: "hooks", version: "1.0.0" } },
        channel: {
          call: async () => {
            engine += 1;
            if (fail) throw new Error("engine down");
            return reply;
          },
          log: (level: string, message: string) => logged.push(`${level}: ${message}`),
        },
      }) as unknown as Wiring;
    const engineOff = { config: {}, capabilities: {}, channel: fakeEngine(null).channel } as unknown as Wiring;

    await definition.start?.(engineOff);
    if (Object.keys(await triggerHook(engineOff as unknown as Call, "Stop", {})).length !== 0) {
      problems.push("an opinion was invented while the engine was off");
    }
    if (engine !== 0) problems.push("the engine was called while it was off");

    await definition.start?.(fakeEngine({ decision: "deny", reason: "no" }));
    const heard = await triggerHook(fakeEngine({ decision: "deny", reason: "no" }) as unknown as Call, "PreToolUse", {});
    if (heard.reason !== "no" || heard.decision !== "deny") {
      problems.push(`the engine's answer did not reach the seam: ${JSON.stringify(heard)}`);
    }
    if (Object.keys(await triggerHook(fakeEngine(null, true) as unknown as Call, "Stop", {})).length !== 0) {
      problems.push("a failed engine call invented an opinion");
    }
    if (!logged.some((line) => line.startsWith("warn: "))) problems.push("a failed engine call was not logged");
    await definition.start?.(engineOff);
    if (hooksAvailable) problems.push("the seam stayed on once the capability went away");

    /// An event the loop has no seam for is not a dead letter: what it says is
    /// written into the turn, so the model it was meant for still reads it.
    await definition.start?.(fakeEngine({}));
    hookAnswer = (params) =>
      params?.event === "SessionStart" ? { context: [{ source: "hook:loud", text: "remember this" }] } : {};
    const noted = run({ session_id: "noted", cwd: "E:\\proj", input: "hello" }, [scripted("done")]);
    await noted.done;
    hookAnswer = () => ({});
    await definition.start?.(engineOff);
    const written = (saves.at(-1)?.messages ?? []) as Message[];
    if (!written.some((message) => message.name === "hook:loud" && message.content === "remember this")) {
      problems.push(`a hook that spoke at SessionStart was not written into the turn: ${JSON.stringify(written)}`);
    }

    const info = definition.methods.info?.({}, {} as Call) as { levels?: string[]; thinking?: unknown } | undefined;
    if (info?.levels?.join(",") !== LEVELS.join(",")) problems.push(`info returned ${JSON.stringify(info)}`);

    let asked = 0;
    const deltas: string[] = [];
    const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
    const outcome = await runLoop(
      {
        tools: [],
        max_steps: 4,
        chat: async (step) => {
          asked += 1;
          if (asked === 1) {
            step.delta({ text: "→" });
            step.delta({ reasoning: "plan" });
            return {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"n":1}' } }],
            };
          }
          step.delta({ text: "done" });
          return { role: "assistant", content: "done" };
        },
        callTool: async (call) => ({ name: call.name, args: call.args }),
      },
      messages,
      new AbortController().signal,
      (event) => {
        if (event.type === "text") deltas.push(event.text);
      },
    );
    if (outcome.text !== "done") problems.push(`loop text ${JSON.stringify(outcome.text)}`);
    if (outcome.steps !== 2) problems.push(`loop took ${outcome.steps} steps, expected 2`);
    if (outcome.reason !== "completed") problems.push(`loop ended as ${outcome.reason}, expected completed`);
    if (!messages.some((message) => message.role === "tool")) problems.push("loop never wrote a tool result back");
    if (deltas.join("") !== "→done") problems.push(`deltas came out as ${JSON.stringify(deltas)}`);

    /// A tool result may ask the run to change, and the run applies it without
    /// knowing which tool asked: the narrowing, the model and the hooks all come
    /// off one `control` field on the result.
    {
      const seen: Array<{ tools?: ToolSpec[]; model?: string }> = [];
      const hookCalls: Array<{ method: string; params: any }> = [];
      const answers = [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "skill", arguments: "{}" } }] },
        { role: "assistant", content: "done" },
      ];
      const calls2: Message[] = [{ role: "user", content: "go" }];
      const saves2: Array<Record<string, any>> = [];
      definition.start?.({
        channel: { log: (): void => {} },
        config: {},
        capabilities: { hooks: { plugin: "@maota/hooks-native", version: "1.0.0" } },
      } as unknown as Wiring);
      const call = {
        channel: {
          call: async (capability: string, method: string, params: any) => {
            if (capability === "tools" && method === "list") {
              return {
                tools: [
                  { name: "read", description: "read" },
                  { name: "write", description: "write" },
                  { name: "skill", description: "load a skill" },
                ],
              };
            }
            if (capability === "tools" && method === "classify") return { safe: true };
            if (capability === "tools" && method === "call") {
              return {
                content: "the instructions",
                control: {
                  tools_allow: ["read"],
                  model: "small",
                  hooks: [{ event: "PreToolUse", command: "guard.ps1" }],
                },
              };
            }
            if (capability === "session" && method === "load") return { messages: calls2 };
            if (capability === "session" && method === "save") {
              saves2.push(params);
              return {};
            }
            if (capability === "hooks" && (method === "register" || method === "unregister")) {
              hookCalls.push({ method, params });
              return {};
            }
            throw new Error(`unexpected call ${capability}/${method}`);
          },
          stream: async (_capability: string, _method: string, params: any) => {
            seen.push(params);
            const message = answers.shift() ?? { role: "assistant", content: "done" };
            return { async *[Symbol.asyncIterator]() { yield { type: "message", message }; } };
          },
          log: () => {},
        },
        config: {},
        capabilities: {},
        capability: "agent.loop",
        method: "run",
        signal: new AbortController().signal,
        stream: { push: () => {} },
      } as unknown as Call;
      await definition.methods.run?.({ session_id: "ctrl", cwd: "E:\\proj", input: "go" }, call);
      if ((seen[0]?.tools ?? []).map((tool) => tool.name).join(",") !== "read,write,skill") {
        problems.push(`the first step listed ${surfaced(seen)}`);
      }
      if (seen[0]?.model !== undefined) problems.push("an unrelated run picked up a model on its own");
      if ((seen[1]?.tools ?? []).map((tool) => tool.name).join(",") !== "read") {
        problems.push(`the narrowed step listed ${surfaced(seen)}`);
      }
      if (seen[1]?.model !== "small") problems.push(`the narrowed step asked for ${String(seen[1]?.model)}`);
      const saved = (saves2.at(-1)?.messages ?? []) as Message[];
      const result = saved.find((message) => message.role === "tool");
      if (result?.content !== "the instructions") {
        problems.push(`the model read ${JSON.stringify(result?.content)}`);
      }
      if (hookCalls.map((entry) => entry.method).join(",") !== "register,unregister") {
        problems.push(`the skill hooks were ${hookCalls.map((entry) => entry.method).join(",") || "never touched"}`);
      }
      if (hookCalls[0]?.params?.scope !== "ctrl:c1") {
        problems.push(`the hooks were scoped as ${String(hookCalls[0]?.params?.scope)}`);
      }
      if (hookCalls[0]?.params?.hooks?.[0]?.command !== "guard.ps1") {
        problems.push("the hook the tool brought was not handed over");
      }
    }

    /// `context: fork` runs the body on its own and brings back only its last
    /// words: the call that asked gets a result rather than a transcript.
    {
      const opened: Array<{ origin?: { type?: string }; tools_deny?: string[]; input?: string }> = [];
      const saves3: Array<Record<string, any>> = [];
      const answers = [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "skill", arguments: "{}" } }] },
        { role: "assistant", content: "done" },
      ];
      const call = {
        channel: {
          call: async (capability: string, method: string, params: any) => {
            if (capability === "tools" && method === "list") {
              return { tools: [{ name: "skill", description: "load a skill" }] };
            }
            if (capability === "tools" && method === "classify") return { safe: true };
            if (capability === "tools" && method === "call") {
              return { content: "review this", control: { context: "fork" } };
            }
            if (capability === "session" && method === "load") return { messages: [{ role: "user", content: "go" }] };
            if (capability === "session" && method === "save") {
              saves3.push(params as Record<string, any>);
              return {};
            }
            throw new Error(`unexpected call ${capability}/${method}`);
          },
          stream: async (_capability: string, _method: string, params: any) => {
            if (params.origin !== undefined) {
              opened.push(params);
              return {
                async *[Symbol.asyncIterator]() {
                  yield { type: "done", steps: 2, text: "the review", reason: "completed" };
                },
              };
            }
            const message = answers.shift() ?? { role: "assistant", content: "done" };
            return { async *[Symbol.asyncIterator]() { yield { type: "message", message }; } };
          },
          log: () => {},
        },
        config: {},
        capabilities: {},
        capability: "agent.loop",
        method: "run",
        signal: new AbortController().signal,
        stream: { push: () => {} },
      } as unknown as Call;
      await definition.methods.run?.({ session_id: "fork", cwd: "E:\\proj", input: "go" }, call);
      if (opened.length !== 1) problems.push(`a forked body opened ${opened.length} child runs`);
      if (opened[0]?.origin?.type !== "skill") problems.push(`a forked body opened as ${String(opened[0]?.origin?.type)}`);
      if ((opened[0]?.tools_deny ?? []).join(",") !== "skill") {
        problems.push("a forked body could reach for the skill tool again");
      }
      if (opened[0]?.input !== "review this") problems.push(`the child was handed ${JSON.stringify(opened[0]?.input)}`);
      const forked = ((saves3.at(-1)?.messages ?? []) as Message[]).find((message) => message.role === "tool");
      if (forked?.content !== "the review") problems.push(`the fork wrote back ${JSON.stringify(forked?.content)}`);
    }

    /// A long history is folded once before the turn runs, and the folded form
    /// is what is stored: the next turn reads a note instead of the whole day.
    {
      const quiet = catalogReply;
      catalogReply = { complete: true, entries: [], text: "" };
      definition.setup?.({
        channel: undefined,
        config: { compact_after_chars: 200, compact_keep_messages: 2 },
        capabilities: {},
      } as unknown as Wiring);
      historyReply = [
        { role: "user", content: `an old question ${"x".repeat(300)}` },
        { role: "assistant", content: "an old answer" },
        { role: "user", content: "another old question" },
        { role: "assistant", content: "another old answer" },
      ];
      const folded = run({ session_id: "fold", cwd: "E:\\proj", input: "and now" }, [scripted("done")]);
      await folded.done;
      const stored = (saves.at(-1)?.messages ?? []) as Message[];
      if (stored[0]?.name !== "compact" || stored[1]?.role !== "assistant") {
        problems.push(`a folded history opened with ${JSON.stringify(stored.slice(0, 2))}`);
      }
      const note = stored[0]?.source as { kind?: unknown; folded?: unknown } | undefined;
      if (note?.kind !== "compact" || note.folded !== 3) {
        problems.push(`the compact note carried ${JSON.stringify(note)}`);
      }
      if (stored[0]?.content !== "folded note") problems.push("the compact note is not the summary that came back");
      if (stored.length !== 4) {
        problems.push(`a folded history kept ${stored.length} messages, expected the note, the kept pair and the answer`);
      }
      if (!folded.heard.some((item) => item.capability === "api" && item.method === "chat")) {
        problems.push("a fold never asked the model to summarise");
      }
      if (folded.chat.length !== 1) problems.push(`a folded turn ran ${folded.chat.length} steps, expected 1`);
      catalogReply = quiet;
    }

    /// The step ceiling leaves a note behind, because the next turn has to know
    /// the work is unfinished.
    {
      definition.setup?.({ channel: undefined, config: {}, capabilities: {} } as unknown as Wiring);
      historyReply = [{ role: "user", content: "earlier" }];
      const stalled = run({ session_id: "stall", cwd: "E:\\proj", input: "go", max_steps: 1 }, [
        scripted("", "read"),
      ]);
      await stalled.done;
      const stored = (saves.at(-1)?.messages ?? []) as Message[];
      const last = stored.at(-1);
      if (last?.name !== "agent:max_steps") problems.push(`a stalled turn stored ${JSON.stringify(last?.name)}`);
      if (last?.content?.includes("step ceiling") !== true) {
        problems.push(`the stall note said ${JSON.stringify(last?.content)}`);
      }
      const done = stalled.events.at(-1) as { reason?: unknown } | undefined;
      if (done?.reason !== "max_steps") problems.push(`a stalled turn ended as ${String(done?.reason)}`);
    }

    /// A model call that fails for good ends the turn as `model_error` instead
    /// of crashing the run, and what the turn had is still saved.
    {
      const broken = run({ session_id: "boom", cwd: "E:\\proj", input: "hi" }, [], undefined, true);
      await broken.done;
      const done = broken.events.at(-1) as { type?: unknown; reason?: unknown; text?: unknown } | undefined;
      if (done?.type !== "done" || done.reason !== "model_error") {
        problems.push(`a failed model call ended as ${JSON.stringify(done)}`);
      }
      if (String(done?.text).includes("upstream broke") !== true) {
        problems.push(`the failure was reported as ${JSON.stringify(done?.text)}`);
      }
      if (saves.at(-1)?.id !== "boom") problems.push("a failed turn was not saved");
    }

    /// Depth is counted, not guessed: a child of the session that is running is
    /// one deeper, and a deployment that sets a ceiling is obeyed.
    {
      definition.setup?.({ channel: undefined, config: { max_depth: 1 }, capabilities: {} } as unknown as Wiring);
      const direct = run({ session_id: "deep", cwd: "E:\\proj", input: "x", depth: 2 }, [scripted("done")]);
      await direct.done;
      const refused = direct.events.at(-1) as { reason?: unknown } | undefined;
      if (refused?.reason !== "refused") problems.push(`a run past max_depth ended as ${String(refused?.reason)}`);
      if (direct.chat.length !== 0) problems.push("a run past max_depth still called the model");

      definition.setup?.({ channel: undefined, config: { max_depth: 0 }, capabilities: {} } as unknown as Wiring);
      const child = run(
        {
          session_id: "kid",
          cwd: "E:\\proj",
          input: "x",
          origin: { parent_session_id: "p9", parent_call_id: "c9" },
        },
        [scripted("done")],
      );
      await child.done;
      const childDone = child.events.at(-1) as { reason?: unknown } | undefined;
      if (childDone?.reason !== "refused") {
        problems.push(`a child past max_depth ended as ${String(childDone?.reason)}`);
      }
      definition.setup?.({ channel: undefined, config: {}, capabilities: {} } as unknown as Wiring);
    }
    return problems;
  },
};

runPlugin(definition);
