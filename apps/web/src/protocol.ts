import type { Language } from "@maota/i18n-protocol";

export interface RpcFailure {
  code: number;
  message: string;
}

/// The interface's words as the host built them: every language any plugin
/// declared, every namespace it contributed, and the problems the store found
/// while folding them together. The app's own copy is compiled in, so this is
/// only what the plugins added.
export interface HostCatalog {
  locale: string;
  languages: Language[];
  namespaces: string[];
  catalog: Record<string, Record<string, Record<string, string>>>;
  problems: string[];
}

export interface AppInfo {
  version: string;
  url: string;
  listening: boolean;
  dev: boolean;
  sessions_dir: string | null;
  levels: string[];
  thinking: Record<string, { model?: string; tools?: boolean }> | null;
  has_key: boolean | null;
  capabilities: Record<string, { plugin: string }>;
  i18n: HostCatalog | null;
}

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  created_at?: string;
  updated_at: string;
  parent?: SessionParent | null;
}

/// A subagent's link back to the call that started it, as the session document
/// keeps it: the parent's id and working directory, the id of the `task` call
/// it hangs under, and the label that call carried.
export interface SessionParent {
  id: string;
  cwd: string;
  call_id: string;
  type: string;
  description: string;
}

export interface SubagentRef {
  id: string;
  type?: string;
  description?: string;
}

export interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/// What the harness attached to a message it wrote for itself. The only kind so
/// far is the skill catalog, whose `entries` are what the model last read, so a
/// reader can tell an injected note from something a person typed.
export interface SessionMessageSource {
  kind: string;
  update?: boolean;
  entries?: Array<{ name: string; description: string }>;
}

export interface SessionMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  source?: SessionMessageSource;
}

export interface SessionFile {
  schema_version: number;
  id: string;
  cwd: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: SessionMessage[];
  dangling: boolean;
}

/// A model-request failure as a front end reads it: the kind decides what the
/// page says and whether a retry is even thinkable, and the message is what the
/// provider said.
export interface HostFailure {
  message: string;
  code: number;
  kind: string;
  status?: number;
  retry_after_ms?: number;
  request_id?: string;
}

export interface HostEvent {
  event: string;
  turn_id?: string;
  session_id?: string;
  text?: string;
  step?: number;
  tool?: string;
  id?: string;
  args?: unknown;
  ok?: boolean;
  output?: unknown;
  steps?: number;
  code?: number;
  message?: string;
  request_id?: string;
  call_id?: string;
  reason?: string;
  outcome?: string;
  subagent_id?: string;
  parent_call_id?: string;
  type?: string;
  description?: string;
  subagent?: SubagentRef;
  failure?: HostFailure;
}

export interface Approval {
  id: string;
  session_id: string;
  tool: string;
  call_id?: string;
  reason?: string;
  at?: string;
  subagent?: SubagentRef;
}

export interface BridgeFacts {
  sessions_dir: string | null;
  levels: string[];
  thinking: Record<string, { model?: string; tools?: boolean }> | null;
  has_key: boolean | null;
}

export interface SkillInvocationPolicy {
  modelInvocable: boolean;
  userInvocable: boolean;
}

/// One skill as the registry reports it: the one line the model reads before it
/// decides, where the skill came from, what discovered it, and whether this
/// working directory activates it.
export interface SkillSummary {
  name: string;
  description: string;
  whenToUse?: string;
  source: string;
  provider: string;
  invocation: SkillInvocationPolicy;
  paths?: string[];
  active: boolean;
  resourceBase?: { kind: "directory"; path: string };
  inert?: string[];
}
