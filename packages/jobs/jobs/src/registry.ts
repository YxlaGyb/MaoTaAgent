import { CallError } from "@maota/plugin-kit";

import { Admission, type AdmissionLimits } from "./admission.ts";
import { OutputRing } from "./ring.ts";
import type { JobRead, JobSettledEvent, JobStatus, JobView } from "./types.ts";

interface Tracked {
  id: string;
  kind: string;
  label: string;
  owner?: string;
  cwd?: string;
  producer: string;
  producer_job_id: string;
  status: JobStatus;
  progress?: string;
  detail?: string;
  result?: string;
  created_at: string;
  started_at: string;
  ended_at?: string;
  ring: OutputRing;
  awaited: boolean;
  waiter?: (view: JobView) => void;
  settled: boolean;
}

interface RegistryOptions extends AdmissionLimits {
  runningBytes: number;
  settledBytes: number;
}

type Emit = (topic: string, payload: unknown) => void;
type Cancel = (producer: string, jobId: string, reason?: string) => Promise<void>;

export class JobRegistry {
  private readonly admission: Admission;
  private readonly options: RegistryOptions;
  private readonly emit: Emit;
  private readonly cancel: Cancel;
  private readonly records = new Map<string, Tracked>();
  private readonly order: string[] = [];
  private next = 0;

  constructor(options: RegistryOptions, emit: Emit, cancel: Cancel) {
    this.options = options;
    this.admission = new Admission({ per_owner: options.per_owner, total: options.total });
    this.emit = emit;
    this.cancel = cancel;
  }

  register(params: any): { id: string } {
    const kind = String(params?.kind ?? "");
    const label = String(params?.label ?? "");
    const producer = String(params?.producer ?? "");
    const producerJobId = String(params?.producer_job_id ?? "");
    const owner = typeof params?.owner === "string" && params.owner !== "" ? params.owner : undefined;
    if (!/^[a-z][a-z0-9_-]*$/.test(kind)) throw new CallError(-32602, "kind must be a lowercase job kind");
    if (label.trim() === "") throw new CallError(-32602, "label is required");
    if (producer.trim() === "" || producerJobId.trim() === "") throw new CallError(-32602, "producer identity is required");
    this.admission.take(owner);
    try {
      const id = `${kind}-${++this.next}`;
      const now = new Date().toISOString();
      const record: Tracked = {
        id,
        kind,
        label,
        ...(owner === undefined ? {} : { owner }),
        ...(typeof params?.cwd === "string" && params.cwd !== "" ? { cwd: params.cwd } : {}),
        producer,
        producer_job_id: producerJobId,
        status: "running",
        created_at: now,
        started_at: now,
        ring: new OutputRing(),
        awaited: false,
        settled: false,
      };
      this.records.set(id, record);
      this.order.push(id);
      this.emit("jobs.registered", this.view(record));
      return { id };
    } catch (error) {
      this.admission.release(owner);
      throw error;
    }
  }

  append(params: any): void {
    const record = this.live(String(params?.id ?? ""));
    record.ring.append(String(params?.text ?? ""), typeof params?.channel === "string" ? params.channel : undefined, params?.gap_before === true);
    record.ring.trim(this.options.runningBytes);
  }

  progress(params: any): void {
    const record = this.live(String(params?.id ?? ""));
    const line = String(params?.line ?? "");
    if (line === "") delete record.progress;
    else record.progress = line;
    this.emit("jobs.progress", this.view(record));
  }

  settle(params: any): JobView {
    const record = this.records.get(String(params?.id ?? ""));
    if (record === undefined) throw new CallError(-32602, "unknown job");
    if (record.settled) return this.view(record);
    const status = String(params?.status ?? "completed");
    if (status !== "completed" && status !== "failed" && status !== "killed") {
      throw new CallError(-32602, "status must be completed, failed, or killed");
    }
    record.status = status;
    if (typeof params?.detail === "string" && params.detail !== "") record.detail = params.detail;
    if (typeof params?.result === "string") record.result = params.result;
    record.ended_at = new Date().toISOString();
    record.settled = true;
    record.ring.settle(record.result, this.options.settledBytes);
    this.admission.release(record.owner);
    const awaited = record.awaited;
    record.waiter?.(this.view(record));
    delete record.waiter;
    const event: JobSettledEvent = { ...this.view(record), cause: "producer", awaited };
    this.emit("jobs.settled", event);
    return this.view(record);
  }

  list(owner?: string): JobView[] {
    return this.order
      .map((id) => this.records.get(id))
      .filter((record): record is Tracked => record !== undefined)
      .filter((record) => owner === undefined || record.owner === owner)
      .map((record) => this.view(record));
  }

  get(id: string, owner?: string): JobView {
    return this.view(this.owned(id, owner));
  }

  read(id: string, owner?: string): JobRead {
    const record = this.owned(id, owner);
    const read = record.ring.read(this.view(record));
    if (record.settled && !read.result && record.status !== "running") {
      this.records.delete(record.id);
      this.emit("jobs.removed", { id: record.id });
    }
    return read;
  }

  async wait(id: string, owner?: string, timeoutMs = 30_000): Promise<JobView> {
    const record = this.owned(id, owner);
    if (record.settled) return this.view(record);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new CallError(-32602, "timeout must be positive");
    record.awaited = true;
    return await new Promise<JobView>((resolve) => {
      const timer = setTimeout(() => {
        record.awaited = false;
        resolve(this.view(record));
      }, timeoutMs);
      record.waiter = (view) => {
        clearTimeout(timer);
        resolve(view);
      };
    });
  }

  async kill(id: string, owner?: string, reason?: string): Promise<{ outcome: "requested" | "already-finished" }> {
    const record = this.owned(id, owner);
    if (record.settled) return { outcome: "already-finished" };
    record.status = "stopping";
    this.emit("jobs.progress", this.view(record));
    await this.cancel(record.producer, record.producer_job_id, reason);
    return { outcome: "requested" };
  }

  async cancelOwner(owner: string, reason: string): Promise<void> {
    const live = this.list(owner).filter((job) => job.status === "running" || job.status === "stopping");
    await Promise.allSettled(live.map((job) => this.kill(job.id, owner, reason)));
  }

  liveIds(): string[] {
    return this.list().filter((job) => job.status === "running" || job.status === "stopping").map((job) => job.id);
  }

  private owned(id: string, owner?: string): Tracked {
    const record = this.records.get(id);
    if (record === undefined) throw new CallError(-32602, `unknown job ${JSON.stringify(id)}`);
    if (owner !== undefined && record.owner !== owner) throw new CallError(-32602, `job ${id} belongs to another owner`);
    return record;
  }

  private live(id: string): Tracked {
    const record = this.records.get(id);
    if (record === undefined) throw new CallError(-32602, `unknown job ${JSON.stringify(id)}`);
    if (record.settled) throw new CallError(-32602, `job ${id} is already settled`);
    return record;
  }

  private view(record: Tracked): JobView {
    return {
      id: record.id,
      kind: record.kind,
      label: record.label,
      ...(record.owner === undefined ? {} : { owner: record.owner }),
      status: record.status,
      ...(record.progress === undefined ? {} : { progress: record.progress }),
      ...(record.detail === undefined ? {} : { detail: record.detail }),
      ...(record.result === undefined ? {} : { result: record.result }),
      created_at: record.created_at,
      started_at: record.started_at,
      ...(record.ended_at === undefined ? {} : { ended_at: record.ended_at }),
    };
  }
}