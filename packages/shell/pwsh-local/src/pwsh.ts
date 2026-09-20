import { spawn } from "node:child_process";

import { CallError } from "@maota/plugin-kit";
import type { ShellRunResult } from "@maota/shell";

export interface RunOptions {
  command: string;
  timeout_ms: number;
  max_output_bytes: number;
  cwd: string | undefined;
  signal: AbortSignal;
}

export const ENCODING_PREAMBLE =
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";

export const ENV_OVERRIDES = { NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat" };

export function pwshCandidates(): string[] {
  const configured = process.env.MAOTA_PWSH;
  const fallbacks = ["pwsh", "powershell"];
  return configured !== undefined && configured.trim() !== ""
    ? [configured, ...fallbacks.filter((item) => item !== configured)]
    : fallbacks;
}

function attempt(file: string, options: RunOptions): Promise<ShellRunResult> {
  return new Promise<ShellRunResult>((resolve, reject) => {
    const child = spawn(file, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ENCODING_PREAMBLE + options.command], {
      cwd: options.cwd,
      env: { ...process.env, ...ENV_OVERRIDES },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (options.signal.aborted) child.kill();

    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let truncated = false;
    let timed_out = false;
    let settled = false;

    const take = (into: Buffer, chunk: Buffer): Buffer => {
      const room = options.max_output_bytes - into.length;
      if (chunk.length <= room) return Buffer.concat([into, chunk]);
      truncated = true;
      return room > 0 ? Buffer.concat([into, chunk.subarray(0, room)]) : into;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = take(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = take(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timed_out = true;
      child.kill();
    }, options.timeout_ms);

    const onAbort = (): void => {
      child.kill();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    const done = (): void => {
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
    };

    child.on("error", (error) => {
      if (settled) return;
      done();
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      done();
      resolve({
        command: options.command,
        exit_code: code,
        signal,
        timed_out,
        truncated,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
  });
}

export async function runPwsh(options: RunOptions): Promise<ShellRunResult> {
  let last: unknown = null;
  for (const candidate of pwshCandidates()) {
    try {
      return await attempt(candidate, options);
    } catch (error) {
      last = error;
      if ((error as { code?: unknown }).code !== "ENOENT") break;
    }
  }
  throw new CallError(-32603, `could not start PowerShell: ${last instanceof Error ? last.message : String(last)}`);
}