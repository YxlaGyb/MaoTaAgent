// 跑一条命令。没有沙箱、没有白名单 —— 这个工具的全部价值就是把命令跑起来;
// 该不该跑由调用方（宿主）决定，插件只负责跑、收、超时、截断。
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

/** win32 上 shell:true 是 cmd.exe，别处是 /bin/sh。 */
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

    // ponytail: kill() 只杀直接子进程，shell 拉起来的孙子进程在 Windows 上会活下来。
    // 需要连坐时换成 taskkill /T 或 Job Object。
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