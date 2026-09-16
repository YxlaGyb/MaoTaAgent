// 一根管道上的两个方向: 内核发来的请求（我们回结果），我们发出去的请求（内核回结果）。
// 分帧在 frame.ts，生命周期在 plugin.ts —— 这里只管"话怎么说"。
import { frameReader, writeFrame } from "./frame.ts";

export interface Route {
  plugin: string;
  version: string;
}

/** 内核回的错。code 见 PROTOCOL.md 第 10 节。 */
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

/** 我当调用方收到的一条流（PROTOCOL.md 7.1）。break 出 for-await 就是放弃它。 */
export interface InboundStream extends AsyncIterable<unknown> {
  readonly stream_id: string;
  cancel(): void;
}

type Waiter = {
  resolve(result: IteratorResult<unknown>): void;
  reject(error: Error): void;
};

/** 没人取就先攒着；关掉之后到达的东西直接丢。 */
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

/** Channel 把收到的帧交给这三件事；它们的含义由 plugin.ts 定。 */
export interface ChannelHooks {
  request(method: string, params: any, reply: (result: unknown) => void): Promise<void> | void;
  notification(method: string, params: any): void;
  event(topic: string, seq: number, payload: unknown): void;
}

export interface CallOptions {
  /** 给这次调用的超时；不写就用提供方自己的默认值。 */
  timeout_ms?: number;
  /** 取消时发 $/cancel（PROTOCOL.md 7.6）。 */
  signal?: AbortSignal;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class Channel {
  private readonly hooks: ChannelHooks;
  private readonly pending = new Map<string, PendingCall>();
  /** 我们当调用方的流，键是内核起的 f-N。 */
  private readonly streams = new Map<string, Queue>();
  private next = 0;

  constructor(hooks: ChannelHooks) {
    this.hooks = hooks;
  }

  /** 开始读 fd 0。内核关掉 stdin 就是"该走了"。 */
  listen(): void {
    process.stdin.on("data", frameReader((body) => this.receive(JSON.parse(body.toString("utf8")))));
    process.stdin.on("end", () => process.exit(0));
  }

  /** 一问一答。 */
  call(capability: string, method: string, params: unknown, options: CallOptions = {}): Promise<unknown> {
    return this.invoke(capability, method, params, {}, options);
  }

  /** 要一条流: 先拿到内核起的 stream_id，再收块。 */
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

  /** 唯一推荐的日志通道（PROTOCOL.md 4.4）: 结构化、内核补 plugin 字段、按行截断。 */
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
    const cancel = (): void => {
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
    if (!call) return; // 不是给我们的回复
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
      // 已经回过包说明这是条流 —— plugin.ts 那边用 $/stream/error 收的尾。
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
      case "$/stream/chunk": {
        const streamId = String(params?.stream_id);
        const queue = this.streams.get(streamId);
        if (!queue) return; // 我们放弃掉的那条流: 块到得比 $/cancel 晚
        if (params?.done === true) {
          this.streams.delete(streamId);
          queue.close();
        } else {
          queue.push(params?.data);
        }
        return;
      }
      case "$/stream/error": {
        const streamId = String(params?.stream_id);
        const queue = this.streams.get(streamId);
        if (!queue) return;
        this.streams.delete(streamId);
        queue.fail(
          new CallError(Number(params?.code ?? -32603), String(params?.message ?? "stream failed"), params?.data),
        );
        return;
      }
      case "$/event":
        this.hooks.event(String(params?.topic ?? ""), Number(params?.seq ?? 0), params?.payload);
        return;
      default:
        this.hooks.notification(method, params);
    }
  }
}