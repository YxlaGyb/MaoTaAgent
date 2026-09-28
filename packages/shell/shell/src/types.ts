export interface ShellRunRequest {
  command: string;
  workdir?: string;
  timeout_ms?: number;
}

export interface ShellRunResult {
  command: string;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

export interface ShellStartRequest {
  command: string;
  workdir?: string;
  timeout_ms?: number;
  owner: string;
  label?: string;
}

export interface ShellStartResult {
  job_id: string;
}

export interface ShellCancelRequest {
  job_id: string;
  reason?: string;
}

export interface ShellFileRunRequest {
  path: string;
  args: string[];
  workdir?: string;
  timeout_ms?: number;
}