import { randomUUID } from "node:crypto";

import type { TurnEvent, TurnInput, TurnResult, TurnSource } from "./types.ts";

interface Entry {
  id: string;
  seq: number;
  input: TurnInput;
  priority: number;
  wake: boolean;
  controller: AbortController;
  emit: (event: TurnEvent) => void;
  done: (result: TurnResult) => void;
  fail: (error: Error) => void;
}

export interface Submission {
  turn_id: string;
  state: "started" | "queued" | "deferred";
  done: Promise<TurnResult>;
}

export interface QueueOptions {
  maxParallel: number;
  maxSystem: number;
  wakeBudget: number;
}

type Executor = (entry: Entry, signal: AbortSignal) => Promise<TurnResult>;

export class TurnQueue {
  private readonly options: QueueOptions;
  private readonly execute: Executor;
  private readonly queues = new Map<string, Entry[]>();
  private readonly entries = new Map<string, Entry>();
  private readonly running = new Map<string, Entry>();
  private readonly budgets = new Map<string, number>();
  private readonly deferred = new Map<string, Entry[]>();
  private seq = 0;
  private total = 0;
  private system = 0;

  constructor(options: QueueOptions, execute: Executor) {
    this.options = options;
    this.execute = execute;
  }

  submit(input: TurnInput, wake: boolean, callback?: (event: TurnEvent) => void, signal?: AbortSignal): Submission {
    const id = input.source.kind === "user" ? `turn-${randomUUID()}` : `turn-${input.source.kind}-${randomUUID()}`;
    let resolve!: (result: TurnResult) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<TurnResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entry: Entry = {
      id,
      seq: ++this.seq,
      input,
      priority: input.source.kind === "user" ? 0 : input.source.kind === "job" ? 1 : 2,
      wake,
      controller: new AbortController(),
      emit: (event) => {
        callback?.(event);
      },
      done: resolve,
      fail: reject,
    };
    this.entries.set(id, entry);
    if (signal !== undefined) {
      if (signal.aborted) entry.controller.abort();
      else signal.addEventListener("abort", () => entry.controller.abort(), { once: true });
    }
    if (input.source.kind === "user") {
      this.budgets.set(input.session_id, this.options.wakeBudget);
      this.push(entry);
      const parked = this.deferred.get(input.session_id);
      if (parked !== undefined) {
        this.deferred.delete(input.session_id);
        for (const item of parked) this.push(item);
      }
      return { turn_id: id, state: "started", done };
    }
    if (!wake || this.budget(input.session_id) <= 0) {
      const parked = this.deferred.get(input.session_id) ?? [];
      parked.push(entry);
      this.deferred.set(input.session_id, parked);
      return { turn_id: id, state: "deferred", done };
    }
    this.budgets.set(input.session_id, this.budget(input.session_id) - 1);
    this.push(entry);
    return { turn_id: id, state: this.running.has(input.session_id) ? "queued" : "started", done };
  }

  cancel(turnId: string): boolean {
    const entry = this.entries.get(turnId);
    if (entry === undefined) return false;
    entry.controller.abort();
    for (const [session, queue] of this.queues) {
      const next = queue.filter((item) => item.id !== turnId);
      if (next.length === 0) this.queues.delete(session);
      else this.queues.set(session, next);
    }
    for (const [session, queue] of this.deferred) {
      const next = queue.filter((item) => item.id !== turnId);
      if (next.length === 0) this.deferred.delete(session);
      else this.deferred.set(session, next);
    }
    entry.fail(new Error("turn cancelled"));
    this.entries.delete(turnId);
    return true;
  }

  status(sessionId: string): { running: string | null; queued: number; deferred: number; wake_budget: number } {
    return {
      running: this.running.get(sessionId)?.id ?? null,
      queued: this.queues.get(sessionId)?.length ?? 0,
      deferred: this.deferred.get(sessionId)?.length ?? 0,
      wake_budget: this.budget(sessionId),
    };
  }

  private budget(sessionId: string): number {
    return this.budgets.get(sessionId) ?? this.options.wakeBudget;
  }

  private push(entry: Entry): void {
    const queue = this.queues.get(entry.input.session_id) ?? [];
    queue.push(entry);
    queue.sort((left, right) => left.priority - right.priority || left.seq - right.seq);
    this.queues.set(entry.input.session_id, queue);
    this.pump();
  }

  private pump(): void {
    while (this.total < this.options.maxParallel) {
      const candidate = this.next();
      if (candidate === null) return;
      this.start(candidate);
    }
  }

  private next(): Entry | null {
    let chosen: Entry | null = null;
    for (const [session, queue] of this.queues) {
      if (this.running.has(session) || queue.length === 0) continue;
      const head = queue[0]!;
      if (head.priority > 0 && this.system >= this.options.maxSystem) continue;
      if (chosen === null || head.priority < chosen.priority || (head.priority === chosen.priority && head.seq < chosen.seq)) {
        chosen = head;
      }
    }
    return chosen;
  }

  private start(entry: Entry): void {
    const queue = this.queues.get(entry.input.session_id)!;
    queue.shift();
    if (queue.length === 0) this.queues.delete(entry.input.session_id);
    this.running.set(entry.input.session_id, entry);
    this.total += 1;
    if (entry.priority > 0) this.system += 1;
    entry.emit({ type: "start", turn_id: entry.id, session_id: entry.input.session_id, source: entry.input.source });
    void this.execute(entry, entry.controller.signal)
      .then((result) => entry.done(result))
      .catch((error: unknown) => entry.fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        this.running.delete(entry.input.session_id);
        this.entries.delete(entry.id);
        this.total -= 1;
        if (entry.priority > 0) this.system -= 1;
        this.pump();
      });
  }
}

export function sourcePriority(source: TurnSource): number {
  return source.kind === "user" ? 0 : source.kind === "job" ? 1 : 2;
}