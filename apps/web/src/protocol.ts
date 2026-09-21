export interface RpcFailure {
  code: number;
  message: string;
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
  capabilities: Record<string, { plugin: string; version: string }>;
}

export interface SessionSummary {
  id: string;
  cwd: string;
  title: string;
  updated_at: string;
}

export interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface SessionMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
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
}

export interface Approval {
  id: string;
  session_id: string;
  tool: string;
  call_id?: string;
  reason?: string;
  at?: string;
}

export interface BridgeFacts {
  sessions_dir: string | null;
  levels: string[];
  thinking: Record<string, { model?: string; tools?: boolean }> | null;
  has_key: boolean | null;
}
