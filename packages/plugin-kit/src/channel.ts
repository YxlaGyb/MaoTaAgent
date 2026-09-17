import { frameReader, writeFrame } from "./frame.ts";

export interface Route {
  plugin: string;
  version: string;
}

export class CallError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "CallError";
    this.code = code;
    this.data = data;
  }
}

export interface InboundStream extends AsyncIterable<unknown> {
  readonly stream_id: string;
  cancel(): void;
}

type Waiter = {
  resolve(result: IteratorResult<unknown>): void;
  reject(error: Error): void;
};

class Queue implements AsyncIterable<unknown> {
  private items: unknown[] = [];
  private readonly waiters: Waiter[] = [];
  private closed = false;
  private error: Error | null = null;

  push(value: unknown): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.items.push(value);
  }

  close(): void {
    this.finish(null);
  }

  fail(error: Error): void {
    this.finish(error);
  }

  private finish(error: Error | null): void {
    if (this.closed) return;
    this.closed = true;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift();
        continue;
      }
      if (this.closed) {
        if (this.error) throw this.error;
        return;
      }
      const next = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

export interface ChannelHooks {
  request(method: string, params: any, reply: (result: unknown) => void): Promise<void> | void;
  notification(method: string, params: any): void;
  event(topic: string, seq: number, payload: unknown): void;
}

export interface CallOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class Channel {
  private readonly hooks: ChannelHooks;
  private readonly pending = new Map<string, PendingCall>();
  private readonly streams = new Map<string, Queue>();
  private readonly parked = new Map<string, Array<{ method: string; params: any }>>();
  private next = 0;

  constructor(hooks: ChannelHooks) {
    this.hooks = hooks;
  }

  listen(): void {
    process.stdin.on("data", frameReader((body) => this.receive(JSON.parse(body.toString("utf8")))));
    process.stdin.on("end", () => process.exit(0));
  }

  call(capability: string, method: string, params: unknown, options: CallOptions = {}): Promise<unknown> {
    return this.invoke(capability, method, params, {}, options);
  }

  async stream(capability: string, method: string, params: unknown, options: CallOptions = {}): Promise<InboundStream> {
    const reply = (await this.invoke(capability, method, params, { stream: true }, options)) as {
      stream_id?: string;
    };
    const streamId = String(reply?.stream_id ?? "");
    if (streamId === "") throw new CallError(-32603, `${capability}/${method} did not return a stream_id`);
    return this.attach(streamId);
  }

  notify(method: string, params: unknown): void {
    writeFrame({ jsonrpc: "2.0", method, params });
  }

  log(level: string, message: string, fields: Record<string, unknown> = {}): void {
    this.notify("kernel.log", { level, message, fields });
  }

  private invoke(
    capability: string,
    method: string,
    params: unknown,
    meta: Record<string, unknown>,
    options: CallOptions,
  ): Promise<unknown> {
    const id = `c-${++this.next}`;
    return new Promise<unknown>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error(`cancelled before calling ${capability}/${method}`));
        return;
      }
      const abort = (): void => {
        if (!this.pending.delete(id)) return;
        this.notify("$/cancel", { request_id: id });
        reject(new Error(`cancelled ${capability}/${method}`));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          options.signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          options.signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      writeFrame({
        jsonrpc: "2.0",
        id,
        method: "kernel.invoke",
        params: { capability, method, params, meta: { ...meta, request_id: id, timeout_ms: options.timeout_ms } },
      });
    });
  }

  private attach(streamId: string): InboundStream {
    const queue = new Queue();
    this.streams.set(streamId, queue);
    for (const { method, params } of this.parked.get(streamId) ?? []) this.deliver(method, streamId, params, queue);
    this.parked.delete(streamId);
    const cancel = (): void => {
      this.parked.delete(streamId);
      if (!this.streams.delete(streamId)) return;
      queue.close();
      this.notify("$/cancel", { stream_id: streamId });
    };
    return {
      stream_id: streamId,
      cancel,
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
        try {
          yield* queue;
        } finally {
          cancel();
        }
      },
    };
  }

  private receive(frame: any): void {
    if (typeof frame?.method === "string") {
      if (frame.id === undefined || frame.id === null) this.notification(frame.method, frame.params);
      else void this.answer(frame.id, frame.method, frame.params);
      return;
    }
    this.settle(frame);
  }

  private settle(frame: any): void {
    const key = String(frame?.id);
    const call = this.pending.get(key);
    if (!call) return;
    this.pending.delete(key);
    if (frame.error) call.reject(new CallError(frame.error.code, frame.error.message, frame.error.data));
    else call.resolve(frame.result);
  }

  private async answer(id: number, method: string, params: any): Promise<void> {
    let replied = false;
    const reply = (result: unknown): void => {
      if (replied) return;
      replied = true;
      writeFrame({ jsonrpc: "2.0", id, result: result ?? {} });
    };
    try {
      await this.hooks.request(method, params, reply);
      reply({});
    } catch (error) {
      if (replied) return;
      writeFrame({
        jsonrpc: "2.0",
        id,
        error:
          error instanceof CallError
            ? { code: error.code, message: error.message, data: error.data }
            : { code: -32603, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private notification(method: string, params: any): void {
    switch (method) {
      case "$/stream/chunk":
      case "$/stream/error": {
        const streamId = String(params?.stream_id);
        const queue = this.streams.get(streamId);
        if (queue) this.deliver(method, streamId, params, queue);
        else this.park(streamId, method, params);
        return;
      }
      case "$/event":
        this.hooks.event(String(params?.topic ?? ""), Number(params?.seq ?? 0), params?.payload);
        return;
      default:
        this.hooks.notification(method, params);
    }
  }

  private deliver(method: string, streamId: string, params: any, queue: Queue): void {
    if (method === "$/stream/error") {
      this.streams.delete(streamId);
      queue.fail(
        new CallError(Number(params?.code ?? -32603), String(params?.message ?? "stream failed"), params?.data),
      );
      return;
    }
    if (params?.done === true) {
      this.streams.delete(streamId);
      queue.close();
      return;
    }
    queue.push(params?.data);
  }

  private park(streamId: string, method: string, params: any): void {
    const parked = this.parked.get(streamId) ?? [];
    parked.push({ method, params });
    this.parked.set(streamId, parked);
    while (this.parked.size > 32) {
      const oldest = this.parked.keys().next().value;
      if (oldest === undefined) break;
      this.parked.delete(oldest);
    }
  }
}
