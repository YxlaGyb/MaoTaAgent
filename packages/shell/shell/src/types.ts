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