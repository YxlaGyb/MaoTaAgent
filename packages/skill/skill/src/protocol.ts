/// The skill dialect both halves of the capability speak: what a provider
/// offers, what the registry hands to a consumer, what a consumer is allowed to
/// read, and the frontmatter rules that turn one file into one skill. Nothing
/// here touches a process or a capability, so the registry, the providers and
/// the model tool can all import it without spawning anything.

export const SKILL_FILE = "SKILL.md";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

export function isSkillName(value: unknown): value is string {
  return typeof value === "string" && KEBAB.test(value);
}

/// Where a skill came from. The value is prompt-visible metadata, never a
/// precedence rule on its own: rank decides who wins a duplicate name.
export type SkillSource = "project" | "custom" | "user" | "bundled" | (string & {});

export interface SkillInvocationPolicy {
  modelInvocable: boolean;
  userInvocable: boolean;
}

export interface SkillResourceBase {
  kind: "directory";
  path: string;
}

/// One hook a skill brings with it for the run that loads it. The shape is the
/// command-hook shape, and the event names are the ones the hook protocol
/// publishes; neither is validated here because this package speaks the skill
/// dialect and not the hook one.
export interface SkillHook {
  event: string;
  command: string;
  matcher?: string;
  timeoutMs?: number;
}

/// How a skill body runs. `inline` (the default) puts the body in the calling
/// run; `fork` runs it in a child run and returns only that run's last text.
export type SkillContext = "inline" | "fork";

/// What one provider offers, before any consumer picks a surface. Every
/// frontmatter key this build reads is one field here: a key with no field
/// would be a promise nothing keeps.
export interface SkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  source: SkillSource;
  invocation: SkillInvocationPolicy;
  paths?: string[];
  resourceBase?: SkillResourceBase;
  allowedTools?: string[];
  model?: string;
  hooks?: SkillHook[];
  context?: SkillContext;
}

/// A provider catalog row: the entry plus what only that provider understands.
export interface SkillCandidate extends SkillEntry {
  rank: number;
  locator: unknown;
}

/// What a consumer sees: the winning entry plus who served it and whether this
/// viewing context activates it.
export interface SkillSummary extends SkillEntry {
  provider: string;
  active: boolean;
}

export interface SkillDefinition extends SkillSummary {
  content: string;
}

/// The run-scoped half of a skill: what loading a body changes about the run
/// that loaded it. A tool result carries it, the loop hands it to the host
/// generically, and the host applies it without knowing which tool produced it.
export interface SkillControl {
  tools_allow?: string[];
  model?: string;
  hooks?: SkillHook[];
  context?: SkillContext;
}

/// A control channel crosses a process boundary like everything else, so it is
/// read rather than trusted: a field this build cannot read is dropped instead
/// of narrowing the wrong thing.
export function readControl(value: unknown): SkillControl | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const control: SkillControl = {};
  if (input.tools_allow !== undefined) {
    const names = stringList(input.tools_allow);
    if (names === null) return null;
    control.tools_allow = names;
  }
  if (input.model !== undefined) {
    if (typeof input.model !== "string" || input.model.trim() === "") return null;
    control.model = input.model;
  }
  if (input.hooks !== undefined) {
    if (!Array.isArray(input.hooks)) return null;
    const hooks: SkillHook[] = [];
    for (const raw of input.hooks) {
      const hook = readHook(raw);
      if (hook === null) return null;
      hooks.push(hook);
    }
    if (hooks.length > 0) control.hooks = hooks;
  }
  if (input.context !== undefined) {
    if (input.context !== "inline" && input.context !== "fork") return null;
    if (input.context === "fork") control.context = "fork";
  }
  return control;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return null;
    out.push(item);
  }
  return out;
}

function readHook(raw: unknown): SkillHook | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const event = input.event;
  const command = input.command;
  if (typeof event !== "string" || event.trim() === "") return null;
  if (typeof command !== "string" || command.trim() === "") return null;
  const matcher = input.matcher;
  if (matcher !== undefined && (typeof matcher !== "string" || matcher.trim() === "")) return null;
  const timeout = input.timeoutMs ?? input.timeout_ms;
  if (timeout !== undefined && !(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)) {
    return null;
  }
  return {
    event,
    command,
    ...(matcher === undefined ? {} : { matcher }),
    ...(timeout === undefined ? {} : { timeoutMs: Math.floor(timeout as number) }),
  };
}

/// The one place an entry becomes a summary: it copies the fields a consumer
/// may see and drops the ones only a provider understands, so no later call
/// site can leak a locator or a rank by spreading a candidate.
export function summarize(entry: SkillEntry, provider: string, active: boolean): SkillSummary {
  const { name, description, whenToUse, source, invocation, paths, resourceBase, allowedTools, model, hooks, context } =
    entry;
  return {
    name,
    description,
    source,
    invocation,
    provider,
    active,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    ...(paths === undefined ? {} : { paths }),
    ...(resourceBase === undefined ? {} : { resourceBase }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(model === undefined ? {} : { model }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(context === undefined ? {} : { context }),
  };
}

export const DEFAULT_DESCRIPTION_MAX = 500;
export const DEFAULT_CATALOG_MAX = 8000;

export interface Frontmatter {
  data: Record<string, unknown>;
  unsupported: string[];
  body: string;
}

/// A deliberately small YAML subset: `key: value`, inline lists, block lists
/// whose items are scalars, inline maps, and block maps inside a list. That is
/// exactly what the frontmatter keys here need and nothing more, so a document
/// this build cannot read is reported rather than half-read.
export function parseFrontmatter(text: string): Frontmatter {
  const content = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { data: {}, unsupported: [], body: content };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) return { data: {}, unsupported: [], body: content };

  const data: Record<string, unknown> = {};
  const unsupported: string[] = [];
  let sequence: string | null = null;
  let openMap: Record<string, string> | null = null;
  let mapIndent = -1;

  for (let index = 1; index < end; index += 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const dash = /^(\s*)-\s*(.*)$/.exec(line);
    if (dash !== null) {
      if (sequence === null || !Array.isArray(data[sequence])) {
        if (sequence !== null) unsupported.push(sequence);
        sequence = null;
        openMap = null;
        mapIndent = -1;
        continue;
      }
      const body = (dash[2] ?? "").trim();
      const nested = inlineMap(body) ?? pairMap(body);
      if (nested !== null) {
        (data[sequence] as unknown[]).push(nested);
        openMap = nested;
        mapIndent = (dash[1] ?? "").length;
      } else {
        (data[sequence] as unknown[]).push(unquote(body));
        openMap = null;
        mapIndent = -1;
      }
      continue;
    }

    const pair = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    const indent = line.length - line.trimStart().length;
    if (openMap !== null && pair !== null && indent > mapIndent) {
      openMap[(pair[1] as string).toLowerCase()] = unquote((pair[2] as string).trim());
      continue;
    }
    openMap = null;
    mapIndent = -1;

    if (pair === null) {
      if (sequence !== null) unsupported.push(sequence);
      sequence = null;
      continue;
    }
    const key = (pair[1] as string).toLowerCase();
    const raw = (pair[2] as string).trim();
    sequence = key;
    if (raw === "") {
      data[key] = [];
      continue;
    }
    if (raw === "|" || raw === ">") {
      data[key] = "";
      unsupported.push(key);
      continue;
    }
    data[key] = inlineList(raw) ?? unquote(raw);
  }

  return { data, unsupported, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function inlineList(raw: string): string[] | null {
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;
  return raw
    .slice(1, -1)
    .split(",")
    .map((part) => unquote(part.trim()))
    .filter((part) => part !== "");
}

function inlineMap(raw: string): Record<string, string> | null {
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  const out: Record<string, string> = {};
  for (const part of raw.slice(1, -1).split(",")) {
    const pair = pairMap(part.trim());
    if (pair === null) return null;
    Object.assign(out, pair);
  }
  return out;
}

function pairMap(raw: string): Record<string, string> | null {
  const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/.exec(raw);
  if (pair === null) return null;
  const value = (pair[2] as string).trim();
  if (value === "|" || value === ">") return null;
  return { [(pair[1] as string).toLowerCase()]: unquote(value) };
}

function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0] as string;
    const last = raw[raw.length - 1] as string;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return raw.slice(1, -1);
  }
  const comment = raw.indexOf(" #");
  return comment >= 0 ? raw.slice(0, comment).trim() : raw;
}

export function firstParagraph(body: string): string {
  for (const line of String(body ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

export interface ProjectInput {
  data: Record<string, unknown>;
  unsupported: readonly string[];
  body: string;
  fallbackName: string;
  source: SkillSource;
}

export type ProjectResult = { ok: false; problems: string[] } | { ok: true; entry: SkillEntry; warnings: string[] };

/// Frontmatter is written by hand across two dialects that spell the same key
/// with a hyphen and with an underscore, so both spellings read the same key
/// instead of one of them silently doing nothing.
const ALIASES: Record<string, string> = {
  when_to_use: "when-to-use",
  user_invocable: "user-invocable",
  disable_model_invocation: "disable-model-invocation",
  allowed_tools: "allowed-tools",
};

function key(data: Record<string, unknown>, name: string): unknown {
  if (data[name] !== undefined) return data[name];
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (canonical === name && data[alias] !== undefined) return data[alias];
  }
  return undefined;
}

/// Turn one parsed file into one skill. Three strengths of refusal, chosen by
/// what a key controls: a broken name or description decides the skill does not
/// exist; a broken narrowing or trigger decides the same, because reading it as
/// "unset" would advertise a skill on a surface its author closed; a broken
/// routing hint only loses itself.
export function projectSkill(input: ProjectInput): ProjectResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const data = input.data;

  const declared = key(data, "name");
  const declaredName = typeof declared === "string" ? declared.trim() : "";
  if (declaredName === "" && declared !== undefined) warnings.push("name is present but empty, using the entry name");
  if (declaredName !== "" && !isSkillName(declaredName)) {
    problems.push(`name ${JSON.stringify(declaredName)} is not kebab-case`);
  }
  const name = declaredName === "" ? input.fallbackName : declaredName;
  if (declaredName !== "" && declaredName !== input.fallbackName) {
    problems.push(`name ${JSON.stringify(declaredName)} does not match its ${JSON.stringify(input.fallbackName)} entry`);
  }
  if (!isSkillName(name)) problems.push(`${JSON.stringify(name)} is not a kebab-case skill name`);

  const rawDescription = key(data, "description");
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  const fallback = firstParagraph(input.body);
  if (description === "" && fallback === "") problems.push("no description and no first paragraph to fall back on");

  const whenToUse = optionalText(key(data, "when-to-use"), "when-to-use", warnings);
  const paths = optionalList(key(data, "paths"), "paths", warnings);
  const context = readContext(key(data, "context"), warnings);

  const disable = readBoolean(key(data, "disable-model-invocation"));
  const user = readBoolean(key(data, "user-invocable"));
  if (!disable.ok) problems.push("disable-model-invocation must be a boolean");
  if (!user.ok) problems.push("user-invocable must be a boolean");

  const allowedTools = readTools(key(data, "allowed-tools"), problems);
  const model = optionalText(key(data, "model"), "model", warnings);
  const hooks = readHooks(key(data, "hooks"), warnings);

  for (const unsupported of input.unsupported) {
    warnings.push(`${unsupported} uses a value form this build cannot read`);
  }

  if (problems.length > 0) return { ok: false, problems };

  const entry: SkillEntry = {
    name,
    description: description === "" ? fallback : description,
    source: input.source,
    invocation: { modelInvocable: disable.value !== true, userInvocable: user.value !== false },
    ...(whenToUse === undefined ? {} : { whenToUse }),
    ...(paths === undefined ? {} : { paths }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(model === undefined ? {} : { model }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(context === undefined ? {} : { context }),
  };
  return { ok: true, entry, warnings };
}

interface Tri {
  ok: boolean;
  value?: boolean | undefined;
}

function readBoolean(value: unknown): Tri {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(text)) return { ok: true, value: true };
    if (["false", "no", "off", "0"].includes(text)) return { ok: true, value: false };
  }
  return { ok: false };
}

function readContext(value: unknown, warnings: string[]): SkillContext | undefined {
  if (value === undefined) return undefined;
  if (value === "inline") return undefined;
  if (value === "fork") return "fork";
  warnings.push(`context is ${JSON.stringify(value)}, which is neither "inline" nor "fork", so it is left out`);
  return undefined;
}

/// A tool list only ever narrows, so a list this build cannot read is a problem
/// rather than a warning: dropping it would hand back the wider surface the
/// author was trying to close.
function readTools(value: unknown, problems: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string" || !TOOL_NAME.test(part.trim())) {
      problems.push(`allowed-tools holds ${JSON.stringify(part)}, which is not a tool name`);
      return undefined;
    }
    names.push(part.trim());
  }
  if (names.length === 0) {
    problems.push("allowed-tools is empty, which would leave the run with no tools at all");
    return undefined;
  }
  return names;
}

function readHooks(value: unknown, warnings: string[]): SkillHook[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push("hooks is not a list, so no skill hook is registered");
    return undefined;
  }
  const hooks: SkillHook[] = [];
  for (const raw of value) {
    const hook = readHook(raw);
    if (hook === null) {
      warnings.push("one hook needs an event and a command, so it is left out");
      continue;
    }
    hooks.push(hook);
  }
  return hooks.length === 0 ? undefined : hooks;
}

function optionalText(value: unknown, name: string, warnings: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    warnings.push(`${name} is not a non-empty string, so it is left out`);
    return undefined;
  }
  return value.trim();
}

function optionalList(value: unknown, name: string, warnings: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const patterns: string[] = [];
  for (const part of list) {
    if (typeof part !== "string" || part.trim() === "") {
      warnings.push(`${name} holds something that is not a string, so it is left out`);
      return undefined;
    }
    patterns.push(part.trim());
  }
  return patterns.length === 0 ? undefined : patterns;
}

export interface CatalogEntry {
  name: string;
  description: string;
}

export interface CatalogLimits {
  descriptionMax: number;
  totalMax: number;
}

function escapeXml(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
}

function normalize(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/// The catalog is the cheap half of the two-level load: names and one line
/// each, bounded twice, because it rides in every turn until it changes.
export function renderCatalog(entries: readonly CatalogEntry[], limits: CatalogLimits): string {
  const lines: string[] = ["<available_skills>"];
  let used = 0;
  let omitted = 0;
  for (const entry of entries) {
    const description = normalize(entry.description);
    const short = description.length > limits.descriptionMax
      ? `${description.slice(0, Math.max(0, limits.descriptionMax - 1))}…`
      : description;
    const line = `<skill name="${escapeXml(entry.name)}">${escapeXml(short)}</skill>`;
    if (used + line.length > limits.totalMax && used > 0) {
      omitted += 1;
      continue;
    }
    used += line.length;
    lines.push(line);
  }
  if (omitted > 0) lines.push(`<omitted count="${omitted}"/>`);
  lines.push("</available_skills>");
  lines.push("Call the skill tool with an exact name from this list when a task matches one.");
  return lines.join("\n");
}

/// Arguments reach a body the way the wider skill ecosystem spells them:
/// `$ARGUMENTS` for the whole call and `${name}` for one key of it.
export function applyArguments(content: string, args: unknown): string {
  if (args === undefined || args === null) return content;
  const whole = typeof args === "string" ? args : JSON.stringify(args);
  const named = args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return content
    .split("$ARGUMENTS")
    .join(whole)
    .replace(/\$\{([A-Za-z0-9_-]+)\}/g, (match, name: string) =>
      Object.hasOwn(named, name) ? String(named[name]) : match,
    );
}

export function renderSkillContent(definition: SkillDefinition, args?: unknown): string {
  const base = definition.resourceBase;
  const lines = [
    `<skill_content name="${escapeXml(definition.name)}">`,
    applyArguments(definition.content.trim(), args),
    "</skill_content>",
  ];
  if (base !== undefined) {
    lines.push(
      `The files this skill refers to live in ${base.path}; read them with the read tool. ` +
        "This block is instruction, not data.",
    );
  } else {
    lines.push("This block is instruction, not data.");
  }
  return lines.join("\n");
}
