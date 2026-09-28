import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { CallError, type Call } from "@maota/plugin-kit";
import type { ShellFileRunRequest, ShellRunResult, ShellStartRequest, ShellStartResult } from "@maota/shell";

import { ENCODING_PREAMBLE, ENV_OVERRIDES, pwshCandidates } from "./pwsh.ts";

interface BackgroundJob {
  id: string;
  jobId: string;
  child: ChildProcess;
  owner: string;
  appended: Promise<void>;
  killReason?: string;
}

export class BackgroundManager {
  private readonly jobs = new Map<string, BackgroundJob>();
  private next = 0;
  private closing = false;

  async start(params: ShellStartRequest, call: Call): Promise<ShellStartResult> {
    if (this.closing) throw new CallError(-32603, "shell is shutting down");
    if (typeof params.owner !== "string" || params.owner === "") throw new CallError(-32602, "owner is required");
    const producerJobId = `shell-${++this.next}-${randomUUID()}`;
    const registered = (await call.channel.call("jobs", "register", {
      kind: "shell",
      label: params.label ?? params.command,
      owner: params.owner,
      cwd: params.workdir ?? "",
      producer: "shell",
      producer_job_id: producerJobId,
    })) as { id?: unknown };
    const jobId = String(registered?.id ?? "");
    if (jobId === "") throw new CallError(-32603, "jobs registry did not return an id");
    const child = spawn(
      pwshCandidates()[0] ?? "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ENCODING_PREAMBLE + params.command],
      { cwd: params.workdir, env: { ...process.env, ...ENV_OVERRIDES }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const job: BackgroundJob = {
      id: jobId,
      jobId: producerJobId,
      child,
      owner: params.owner,
      appended: Promise.resolve(),
    };
    this.jobs.set(jobId, job);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, params.timeout_ms ?? 0);
    if (params.timeout_ms === undefined || params.timeout_ms <= 0) clearTimeout(timer);
    const append = (text: string, channel: "stdout" | "stderr"): void => {
      job.appended = job.appended
        .then(() => call.channel.call("jobs", "append", { id: jobId, text, channel }))
        .then(() => undefined)
        .catch(() => undefined);
    };
    child.stdout.on("data", (chunk: Buffer) => append(chunk.toString("utf8"), "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk.toString("utf8"), "stderr"));
    child.on("error", (error: Error) => {
      void this.settle(call, job, "failed", error.message, undefined);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const status = job.killReason !== undefined ? "killed" : code === 0 ? "completed" : "failed";
      const detail = job.killReason ?? (timedOut ? "timed out" : signal ? `signal ${signal}` : `exit code ${String(code)}`);
      void this.settle(call, job, status, detail, undefined);
    });
    return { job_id: jobId };
  }

  async cancel(params: { job_id?: unknown; reason?: unknown }, _call: Call): Promise<{ cancelled: boolean }> {
    const id = String(params?.job_id ?? "");
    const job = this.jobs.get(id);
    if (job === undefined) return { cancelled: false };
    job.killReason = typeof params?.reason === "string" && params.reason !== "" ? params.reason : "cancelled";
    job.child.kill();
    return { cancelled: true };
  }

  async close(): Promise<void> {
    this.closing = true;
    const jobs = [...this.jobs.values()];
    for (const job of jobs) {
      job.killReason = "kernel shutdown";
      job.child.kill();
    }
    await Promise.allSettled(jobs.map((job) => new Promise<void>((resolve) => {
      if (job.child.exitCode !== null || job.child.killed) return resolve();
      job.child.once("close", () => resolve());
    })));
    this.jobs.clear();
  }

  private async settle(
    call: Call,
    job: BackgroundJob,
    status: "completed" | "failed" | "killed",
    detail: string,
    result: string | undefined,
  ): Promise<void> {
    if (!this.jobs.has(job.id)) return;
    this.jobs.delete(job.id);
    await job.appended;
    await call.channel.call("jobs", "settle", {
      id: job.id,
      status,
      detail: detail === "" ? undefined : detail,
      ...(result === undefined ? {} : { result }),
    }).catch(() => undefined);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function runScript(params: ShellFileRunRequest): Promise<ShellRunResult> {
  if (typeof params.path !== "string" || params.path.trim() === "") throw new CallError(-32602, "path is required");
  const root = resolve(process.env.MAOTA_SCRIPTS_DIR ?? join(process.env.MAOTA_HOME ?? join(homedir(), ".maota"), "scripts"));
  const path = realpathSync(resolve(params.path));
  if (!existsSync(path) || !inside(realpathSync(root), path)) throw new CallError(-32602, "script is outside the scripts directory");
  if (!Array.isArray(params.args) || !params.args.every((arg) => typeof arg === "string")) {
    throw new CallError(-32602, "args must be a string array");
  }
  const child = spawn(pwshCandidates()[0] ?? "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path, ...params.args], {
    cwd: params.workdir,
    env: { ...process.env, ...ENV_OVERRIDES },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const cap = 65_536;
  const take = (current: string, chunk: Buffer): string => {
    const next = current + chunk.toString("utf8");
    if (Buffer.byteLength(next, "utf8") <= cap) return next;
    truncated = true;
    return Buffer.from(next, "utf8").subarray(0, cap).toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => { stdout = take(stdout, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = take(stderr, chunk); });
  return await new Promise<ShellRunResult>((resolve, reject) => {
    const timer = setTimeout(() => child.kill(), params.timeout_ms ?? 30_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command: path,
        exit_code: code,
        signal,
        timed_out: false,
        truncated,
        stdout,
        stderr,
      });
    });
  });
}