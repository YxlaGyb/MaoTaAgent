import { spawn } from "node:child_process";

export interface CommandOptions {
  cwd?: string | undefined;
  timeout_ms: number;
  max_output_bytes: number;
  signal?: AbortSignal | undefined;
}

export interface CommandResult {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const done = (): void => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
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