/// The dialect shared by the model router and its adapters. A caller names a
/// provider route and a model; an adapter translates that request to one wire
/// protocol and reports the same normalized chunks, metadata and failures back.
///
/// @module @maota/model-protocol

import { CallError } from "@maota/plugin-kit";

export const MODEL_FAILURE = {
  auth: -32050,
  rate_limit: -32051,
  server: -32052,
  transport: -32053,
  parse: -32054,
  empty: -32055,
  context_window: -32056,
  timeout: -32057,
  quota: -32058,
  conflict: -32059,
} as const;

export const ABORTED = -32013;

export const FAILURE_KINDS = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
  "context_window",
  "auth",
  "quota",
  "request",
  "protocol",
  "aborted",
  "unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export const TRANSIENT_KINDS: readonly FailureKind[] = [
  "rate_limit",
  "server",
  "transport",
  "timeout",
  "empty_response",
];

const BY_CODE = new Map<number, FailureKind>([
  [MODEL_FAILURE.auth, "auth"],
  [MODEL_FAILURE.rate_limit, "rate_limit"],
  [MODEL_FAILURE.server, "server"],
  [MODEL_FAILURE.transport, "transport"],
  [MODEL_FAILURE.parse, "protocol"],
  [MODEL_FAILURE.empty, "empty_response"],
  [MODEL_FAILURE.context_window, "context_window"],
  [MODEL_FAILURE.timeout, "timeout"],
  [MODEL_FAILURE.quota, "quota"],
  [ABORTED, "aborted"],
  [-32602, "request"],
]);

export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && (FAILURE_KINDS as readonly string[]).includes(value);
}

export function isTransient(kind: FailureKind): boolean {
  return TRANSIENT_KINDS.includes(kind);
}

export function kindOfCode(code: number): FailureKind {
  return BY_CODE.get(code) ?? "unknown";
}

export interface ModelFailure {
  message: string;
  code: number;
  kind: FailureKind;
  status?: number;
  retry_after_ms?: number;
  request_id?: string;
}

export interface FailureFacts {
  status?: number;
  retry_after_ms?: number;
  request_id?: string;
}

export function readFacts(value: unknown): FailureFacts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(typeof input.status === "number" && Number.isFinite(input.status) ? { status: input.status } : {}),
    ...(typeof input.retry_after_ms === "number" && Number.isFinite(input.retry_after_ms) && input.retry_after_ms > 0
      ? { retry_after_ms: input.retry_after_ms }
      : {}),
    ...(typeof input.request_id === "string" && input.request_id !== "" ? { request_id: input.request_id } : {}),
  };
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds * 1000);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  const delay = at - now;
  return delay > 0 ? delay : undefined;
}

export function failureOf(error: unknown): ModelFailure {
  const found = (error ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const code = typeof found.code === "number" && Number.isFinite(found.code) ? found.code : -32603;
  const kind = kindOfCode(code);
  const facts = readFacts(found.data);
  return {
    message: typeof found.message === "string" && found.message !== "" ? found.message : "model call failed",
    code,
    kind,
    ...facts,
  };
}

export function readModelFailure(value: unknown): ModelFailure | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.message !== "string" || raw.message === "") return null;
  if (typeof raw.code !== "number" || !Number.isFinite(raw.code)) return null;
  if (!isFailureKind(raw.kind)) return null;
  return { message: raw.message, code: raw.code, kind: raw.kind, ...readFacts(raw) };
}

export function failureError(failure: ModelFailure): CallError {
  return new CallError(failure.code, failure.message, failure);
}

export interface Message {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface SessionRef {
  id: string;
  cwd: string;
  step: number;
}

export interface ToolSpec {
  name: string;
  description?: string;
  input_schema?: unknown;
  parameters?: unknown;
}

export type ProviderAuth = { kind: "file" } | { kind: "env"; name: string };

export interface ProviderProfile {
  id: string;
  name: string;
  adapter: string;
  base_url: string;
  auth: ProviderAuth;
  enabled: boolean;
  verified: boolean;
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  context_tokens?: number;
  max_output_tokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  reasoning_efforts?: string[];
}

export interface ModelProfile {
  provider: string;
  model: string;
  name: string;
  context_tokens?: number;
  max_output_tokens?: number;
  capabilities: ModelCapabilities;
  reasoning_efforts: string[];
  enabled: boolean;
  verified: boolean;
}

export interface ModelRoute {
  provider: string;
  model: string;
  reasoning?: string;
}

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/// A route that asks the legacy API adapter to use the model its own config
/// already selected. It never reaches a wire protocol: the API adapter drops
/// the placeholder so the old plugin keeps owning its default.

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

export interface ModelCatalog {
  revision: number;
  providers: ProviderProfile[];
  models: ModelProfile[];
  default_route: ModelRoute | null;
}

export interface ModelRequest {
  route: ModelRoute;
  messages: Message[];
  tools?: ToolSpec[];
  temperature?: number;
  max_tokens?: number;
  session?: SessionRef;
}

export interface ResolvedModel {
  route: ModelRoute;
  provider: ProviderProfile;
  model: ModelProfile;
}

export interface AdapterDescriptor {
  id: string;
  name: string;
  endpoint_hint?: string;
  key_hint?: string;
}

export interface AdapterChatRequest extends ModelRequest {
  provider: ProviderProfile;
  model: ModelProfile;
  api_key: string;
  idle_timeout_ms?: number;
}

export interface AdapterDiscoveryRequest {
  base_url: string;
  api_key: string;
}

export type ModelStreamChunk =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "message"; message: Message; usage?: unknown }
  | { type: "error"; failure: ModelFailure }
  | { type: "retry"; phase: "scheduled" | "started"; attempt: number; delay_ms: number; failure_kind?: string; reason?: string };

export interface ProviderInput {
  id?: string;
  name: string;
  adapter: string;
  base_url: string;
  auth?: ProviderAuth;
  api_key?: string;
  enabled?: boolean;
  verified?: boolean;
}

export interface ModelInput {
  provider: string;
  model: string;
  name?: string;
  context_tokens?: number;
  max_output_tokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  reasoning_efforts?: string[];
  enabled?: boolean;
  verified?: boolean;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function readProviderInput(value: unknown): ProviderInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, "provider must be an object");
  }
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  const adapter = text(raw.adapter);
  const base_url = text(raw.base_url);
  if (name === undefined || adapter === undefined || base_url === undefined) {
    throw new CallError(-32602, "provider needs name, adapter and base_url");
  }
  const auth = readAuth(raw.auth);
  return {
    ...(text(raw.id) === undefined ? {} : { id: text(raw.id)! }),
    name,
    adapter,
    base_url,
    ...(auth === undefined ? {} : { auth }),
    ...(text(raw.api_key) === undefined ? {} : { api_key: text(raw.api_key)! }),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(raw.verified === true ? { verified: true } : {}),
  };
}

export function readModelInput(value: unknown): ModelInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, "model must be an object");
  }
  const raw = value as Record<string, unknown>;
  const provider = text(raw.provider);
  const model = text(raw.model);
  if (provider === undefined || model === undefined) {
    throw new CallError(-32602, "model needs provider and model");
  }
  const capabilities = raw.capabilities;
  const cap = capabilities !== null && typeof capabilities === "object" && !Array.isArray(capabilities)
    ? capabilities as Record<string, unknown>
    : {};
  return {
    provider,
    model,
    ...(text(raw.name) === undefined ? {} : { name: text(raw.name)! }),
    ...(positive(raw.context_tokens) === undefined ? {} : { context_tokens: positive(raw.context_tokens)! }),
    ...(positive(raw.max_output_tokens) === undefined ? {} : { max_output_tokens: positive(raw.max_output_tokens)! }),
    capabilities: { tools: cap.tools !== false, vision: cap.vision === true },
    reasoning_efforts: Array.isArray(raw.reasoning_efforts)
      ? raw.reasoning_efforts.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [],
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    verified: raw.verified === true,
  };
}

function readAuth(value: unknown): ProviderAuth | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "file") return { kind: "file" };
  if (raw.kind === "env" && typeof raw.name === "string" && raw.name.trim() !== "") {
    return { kind: "env", name: raw.name.trim() };
  }
  return undefined;
}

export function readRoute(value: unknown): ModelRoute {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, "model route must be an object");
  }
  const raw = value as Record<string, unknown>;
  const provider = text(raw.provider);
  const model = text(raw.model);
  if (provider === undefined || model === undefined) {
    throw new CallError(-32602, "model route needs provider and model");
  }
  return {
    provider,
    model,
    ...(text(raw.reasoning) === undefined ? {} : { reasoning: text(raw.reasoning)! }),
  };
}

export function readModelRequest(value: unknown): ModelRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CallError(-32602, "model request must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw new CallError(-32602, "messages must be a non-empty array");
  }
  const messages: Message[] = [];
  for (const message of raw.messages) {
    const read = readMessage(message);
    if (read === null) throw new CallError(-32602, "every message needs a role");
    messages.push(read);
  }
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((tool): tool is ToolSpec => tool !== null && typeof tool === "object" && !Array.isArray(tool) && typeof (tool as { name?: unknown }).name === "string")
    : undefined;
  const session = readSession(raw.session);
  return {
    route: readRoute(raw.route),
    messages,
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    ...(typeof raw.temperature === "number" ? { temperature: raw.temperature } : {}),
    ...(positive(raw.max_tokens) === undefined ? {} : { max_tokens: positive(raw.max_tokens)! }),
    ...(session === undefined ? {} : { session }),
  };
}

function readMessage(value: unknown): Message | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.role !== "string" || raw.role === "") return null;
  const message: Message = { role: raw.role };
  if (typeof raw.content === "string" || raw.content === null) message.content = raw.content;
  if (Array.isArray(raw.tool_calls)) message.tool_calls = raw.tool_calls;
  if (typeof raw.tool_call_id === "string") message.tool_call_id = raw.tool_call_id;
  if (typeof raw.name === "string") message.name = raw.name;
  return message;
}

function readSession(value: unknown): SessionRef | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return undefined;
  return {
    id: raw.id,
    cwd: typeof raw.cwd === "string" ? raw.cwd : "",
    step: typeof raw.step === "number" && Number.isFinite(raw.step) && raw.step > 0 ? Math.floor(raw.step) : 0,
  };
}

export function readCatalog(value: unknown): ModelCatalog {
  const raw = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    revision: typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    providers: Array.isArray(raw.providers) ? raw.providers.map(readProvider).filter((item): item is ProviderProfile => item !== null) : [],
    models: Array.isArray(raw.models) ? raw.models.map(readModel).filter((item): item is ModelProfile => item !== null) : [],
    default_route: readRouteOrNull(raw.default_route),
  };
}

function readProvider(value: unknown): ProviderProfile | null {
  try {
    const input = readProviderInput(value);
    return {
      id: input.id ?? "",
      name: input.name,
      adapter: input.adapter,
      base_url: input.base_url,
      auth: input.auth ?? { kind: "file" },
      enabled: input.enabled !== false,
      verified: input.verified === true,
    };
  } catch {
    return null;
  }
}

function readModel(value: unknown): ModelProfile | null {
  try {
    const input = readModelInput(value);
    return {
      provider: input.provider,
      model: input.model,
      name: input.name ?? input.model,
      ...(input.context_tokens === undefined ? {} : { context_tokens: input.context_tokens }),
      ...(input.max_output_tokens === undefined ? {} : { max_output_tokens: input.max_output_tokens }),
      capabilities: { tools: input.capabilities?.tools !== false, vision: input.capabilities?.vision === true },
      reasoning_efforts: input.reasoning_efforts ?? [],
      enabled: input.enabled !== false,
      verified: input.verified === true,
    };
  } catch {
    return null;
  }
}

function readRouteOrNull(value: unknown): ModelRoute | null {
  try {
    return readRoute(value);
  } catch {
    return null;
  }
}
