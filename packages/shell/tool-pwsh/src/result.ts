import { parseExitStatus, type ShellRunResult } from "@maota/shell";

export interface PwshToolResult {
  command: string;
  status: string;
  ok: boolean;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

export function renderPwshResult(result: ShellRunResult): PwshToolResult {
  const status = parseExitStatus(result);
  return {
    command: result.command,
    status: status.label,
    ok: status.ok,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    truncated: result.truncated,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}