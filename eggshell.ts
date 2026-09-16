// eggshellmod 宿主桥 —— 纯 TypeScript，零依赖，不含任何 Rust。
//
// 内核是一个子进程: fd 0 收宿主的请求，fd 1 发回复与通知，fd 2 是日志。
// 这里只做三件事: 起进程、按 Content-Length 分帧、把帧交给等它的人。
// 协议全文见 eggshellmod/docs/PROTOCOL.md，宿主这一侧是第 14 节。
//
// 用法:
//   const kernel = await boot("./eggshell.toml");
//   const table = await kernel.capabilities();
//   const result = await kernel.invoke("agent.loop", "run", { session_id: "default" });
//   const stream = await kernel.invoke("agent.loop", "run", {}, { stream: true });
//   for await (const chunk of stream) process.stdout.write(String(chunk.data ?? ""));
//   break 出这个循环就等于取消那条流（桥会发 $/cancel）。
//   for await (const event of kernel.subscribe(["loop.*", "kernel.plugin.*"])) { ... }
//   kernel.on(["kernel.plugin.*"], (event) => console.error(event.topic));
//   await kernel.shutdown();

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface KernelOptions {
  /** eggshell 可执行文件。默认 $EGGSHELL_BIN，其次是 PATH 上的 `eggshell`。 */
  bin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** 内核日志（fd 2，一行一个 JSON 对象）。默认原样转到本进程的 stderr。 */
  onLog?: (line: Record<string, unknown>) => void;
}

export interface Chunk {
  stream_id: string;
  /** 内核重编号过的序号，从 0 开始。 */
  seq: number;
  data: unknown;
  /** 流的最后一块。`error` 有值时是内核终止了这条流（PROTOCOL.md 7.x）。 */
  done: boolean;
  error?: { code: number; message: string; data?: unknown };
}

export interface Event {
  topic: string;
  /** 总线级单调递增计数: 用来发现自己掉队，不是每主题的序号。 */
  seq: number;
  payload: unknown;
}

/** 内核回的 JSON-RPC 错误。code 见 PROTOCOL.md 第 10 节那张表。 */
export class KernelError extends Error {
  code: number;
  data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.data = data;
  }
}

const HEADER_END = Buffer.from("\r\n\r\n");
/** 排队字节超过这个数就让内核停手; 降到低水位再放行（PROTOCOL.md 7.4）。 */
const PAUSE_BYTES = 1 << 20;
const RESUME_BYTES = 1 << 18;

interface Call {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Sink {
  patterns: string[];
  queue: Queue<Event>;
}

interface WireFrame {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** 没人消费就先攒着; 攒下的字节数报给上游，用来决定要不要暂停读。 */
class Queue<T> implements AsyncIterable<T> {
  private readonly onTake: () => void;
  private items: Array<{ value: T; bytes: number }> = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private queued = 0;
  private done = false;

  constructor(onTake: () => void = () => {}) {
    this.onTake = onTake;
  }

  push(value: T, bytes = 0): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      this.onTake();
      return;
    }
    this.items.push({ value, bytes });
    this.queued += bytes;
  }

  close(): void {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  get pendingBytes(): number {
    return this.queued;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const head = this.items.shift();
      if (head) {
        this.queued -= head.bytes;
        this.onTake();
        yield head.value;
        continue;
      }
      if (this.done) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

/** `Content-Length` 是字节数，不是字符数。 */
function contentLength(head: Buffer): number | null {
  for (const line of head.toString("utf8").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== "content-length") continue;
    const value = Number(line.slice(colon + 1).trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return null;
}

/** PROTOCOL.md 8.2: 按 `.` 分段逐段比，`*` 恰好一段，`**` 在 v1 不匹配任何东西。 */
function matches(pattern: string, topic: string): boolean {
  if (pattern.includes("**")) return false;
  const want = pattern.split(".");
  const got = topic.split(".");
  return want.length === got.length && want.every((segment, i) => segment === "*" || segment === got[i]);
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}/** 一个活着的内核进程。`boot()` 给你这个。 */
export class Host {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onLog: ((line: Record<string, unknown>) => void) | undefined;
  private readonly calls = new Map<number, Call>();
  private readonly streams = new Map<string, Queue<Chunk>>();
  private readonly parked = new Map<string, Array<{ value: Chunk; bytes: number }>>();
  private readonly sinks: Sink[] = [];
  private readonly stderrTail: string[] = [];
  /** 内核进程的退出码。内核一退，所有等待中的调用和订阅都跟着结束。 */
  readonly exited: Promise<number>;
  private buffer: Buffer = Buffer.alloc(0);
  private subscription: { id: string; patterns: string[] } | null = null;
  private chain: Promise<void> = Promise.resolve();
  private paused = false;
  private nextId = 0;
  private dead: Error | null = null;

  constructor(child: ChildProcessWithoutNullStreams, onLog?: (line: Record<string, unknown>) => void) {
    this.child = child;
    this.onLog = onLog;
    // 内核退出去以后我们还会写 stdin: 不能让 EPIPE 变成未捕获异常。
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => this.feed(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.log(chunk));
    this.exited = new Promise((resolve) => {
      child.once("exit", (code) => {
        this.dead = this.died(code ?? -1);
        this.fail(this.dead);
        resolve(code ?? -1);
      });
    });
  }

  // ------------------------------------------------------------- 公开 API

  /** 内核当前的能力表（快照）。能力热重载过就再问一次。 */
  async capabilities(): Promise<Record<string, { plugin: string; version: string }>> {
    return (await this.request("capabilities", {})) as Record<string, { plugin: string; version: string }>;
  }

  /** 调一个能力。加了 `{stream: true}` 拿到的是块的可迭代对象。 */
  invoke(capability: string, method: string, params?: unknown): Promise<unknown>;
  invoke(capability: string, method: string, params: unknown, opts: { stream: true }): Promise<AsyncIterable<Chunk>>;
  invoke(capability: string, method: string, params: unknown, opts: { stream: false }): Promise<unknown>;
  async invoke(capability: string, method: string, params?: unknown, opts?: { stream?: boolean }): Promise<unknown> {
    if (!opts?.stream) return await this.request("invoke", { capability, method, params });

    const reply = (await this.request("invoke", {
      capability,
      method,
      params,
      meta: { stream: true },
    })) as { stream_id?: string };
    const streamId = String(reply?.stream_id ?? "");
    const queue = new Queue<Chunk>(() => this.flow());
    this.streams.set(streamId, queue);
    // 块可以抢在 `{stream_id}` 回复之前到（内核那两条路径不保证顺序），认领存下的那些。
    const parked = this.parked.get(streamId);
    if (parked) {
      this.parked.delete(streamId);
      for (const item of parked) queue.push(item.value, item.bytes);
      if (parked.some((item) => item.value.done)) queue.close();
    }
    const host = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* queue;
        } finally {
          // 消费者 break 掉（或者抛了）就告诉内核别再推了。取消是幂等的:
          // 那条流早就结束了的话，内核按"不认识的 id"处理。
          host.cancel(streamId);
          host.streams.delete(streamId);
          queue.close();
        }
      },
    };
  }

  /**
   * 放弃一条流（`f-N`，就是 `invoke` 回复里那个）。取消是**通知**不是请求:
   * 内核不回终止帧，迭代就这么结束。取消一个不存在的 id 也无害。
   */
  cancel(streamId: string): void {
    if (this.dead) return;
    this.send({ jsonrpc: "2.0", method: "$/cancel", params: { stream_id: streamId } });
  }

  /** 订阅事件。迭代结束（或提前 return）时自动退订。 */
  subscribe(patterns: string[]): AsyncIterable<Event> {
    const sink: Sink = { patterns, queue: new Queue<Event>(() => this.flow()) };
    this.sinks.push(sink);
    void this.sync();
    const host = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* sink.queue;
        } finally {
          const at = host.sinks.indexOf(sink);
          if (at >= 0) host.sinks.splice(at, 1);
          void host.sync();
        }
      },
    };
  }

  /** 回调版的 `subscribe`。返回值取消这次订阅。 */
  on(patterns: string[], handler: (event: Event) => void): () => void {
    const iterator = this.subscribe(patterns)[Symbol.asyncIterator]();
    void (async () => {
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done) return;
          handler(next.value);
        }
      } catch {
        // 内核没了: 订阅跟着结束（见 exited）。
      }
    })();
    return () => void iterator.return?.(undefined);
  }

  /**
   * 关机: 内核回完这一帧才开始下线，然后进程退出。返回退出码。
   *
   * `reason` 只有两个是宿主能诚实给出的: `ui_quit`（缺省）和 `kernel_exit`
   * （宿主自己要走）。插件始终看到的是协议里那四个值之一。
   */
  async shutdown(reason: "ui_quit" | "kernel_exit" = "ui_quit"): Promise<number> {
    if (!this.dead) {
      try {
        await this.request("shutdown", { reason });
      } catch {
        // 已经死了就不用告别了。
      }
    }
    return await this.exited;
  }

  // --------------------------------------------------------------- 内部

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private send(frame: unknown): void {
    const body = Buffer.from(JSON.stringify(frame), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  /** 一条帧可能跨多个 data 事件，也可能一次来好几条: 缓冲到完整再解析。 */
  private feed(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const head = this.buffer.indexOf(HEADER_END);
      if (head < 0) return;
      const length = contentLength(this.buffer.subarray(0, head));
      if (length === null) {
        this.fail(new Error("内核发来一帧，但没有可用的 Content-Length"));
        return;
      }
      if (this.buffer.length < head + 4 + length) return;
      const body = this.buffer.subarray(head + 4, head + 4 + length);
      this.buffer = this.buffer.subarray(head + 4 + length);
      let frame: WireFrame;
      try {
        frame = JSON.parse(body.toString("utf8")) as WireFrame;
      } catch {
        continue; // 内核不写坏帧; 真坏了也不该把宿主拖下去
      }
      this.dispatch(frame, body.length);
    }
  }

  private dispatch(frame: WireFrame, bytes: number): void {
    if (typeof frame.id === "number") {
      const call = this.calls.get(frame.id);
      if (!call) return;
      this.calls.delete(frame.id);
      const error = frame.error;
      if (error) call.reject(new KernelError(Number(error.code), String(error.message), error.data));
      else call.resolve(frame.result);
      return;
    }

    const params = (frame.params ?? {}) as Record<string, any>;
    switch (frame.method) {
      case "$/stream/chunk": {
        const chunk = params as Chunk;
        const queue = this.streams.get(chunk.stream_id);
        if (!queue) {
          this.park(chunk, bytes);
          break;
        }
        queue.push(chunk, bytes);
        if (chunk.done) {
          this.streams.delete(chunk.stream_id);
          queue.close();
        }
        break;
      }
      case "$/stream/error": {
        // 内核终止了一条流: 归一化成终止块，消费者只看 `error` 有没有值。
        const end: Chunk = {
          stream_id: String(params.stream_id),
          seq: -1,
          data: null,
          done: true,
          error: { code: Number(params.code), message: String(params.message ?? ""), data: params.data },
        };
        const queue = this.streams.get(end.stream_id);
        if (!queue) {
          this.park(end, bytes);
          break;
        }
        queue.push(end, bytes);
        this.streams.delete(end.stream_id);
        queue.close();
        break;
      }
      case "$/event": {
        const event = params as Event;
        for (const sink of this.sinks) {
          if (sink.patterns.some((pattern) => matches(pattern, event.topic))) sink.queue.push(event, bytes);
        }
        break;
      }
      default:
        break; // 宿主只可能收到这几类通知（PROTOCOL.md 14.2）
    }
    this.flow();
  }

  private park(chunk: Chunk, bytes: number): void {
    const parked = this.parked.get(chunk.stream_id);
    if (parked) parked.push({ value: chunk, bytes });
    else this.parked.set(chunk.stream_id, [{ value: chunk, bytes }]);
  }
  /**
   * 攒太多没人消费就让内核那一侧停手: 暂停读 fd 1，内核的宿主队列填满，
   * 它的水位（PROTOCOL.md 7.4）接着暂停提供方。慢消费者不会被我们 OOM。
   */
  private flow(): void {
    if (this.dead) return;
    let bytes = 0;
    for (const queue of this.streams.values()) bytes += queue.pendingBytes;
    for (const sink of this.sinks) bytes += sink.queue.pendingBytes;
    if (!this.paused && bytes > PAUSE_BYTES) {
      this.paused = true;
      this.child.stdout.pause();
    } else if (this.paused && bytes < RESUME_BYTES) {
      this.paused = false;
      this.child.stdout.resume();
    }
  }

  /**
   * 内核不知道"这条事件该给哪个订阅": `$/event` 帧里没有 subscription_id，
   * 它只按图案广播。所以桥只维持**一个**内核订阅（所有本地图案的并集），
   * 收到事件后按每份本地图案自己分发 —— 否则重叠的图案会收到重复投递。
   */
  private sync(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const want = [...new Set(this.sinks.flatMap((sink) => sink.patterns))].sort();
        if (this.subscription && same(want, this.subscription.patterns)) return;
        const previous = this.subscription?.id ?? null;
        if (want.length === 0) {
          this.subscription = null;
        } else {
          const reply = (await this.request("subscribe", { patterns: want })) as { subscription_id?: string };
          this.subscription = { id: String(reply?.subscription_id ?? ""), patterns: want };
        }
        if (previous) void this.request("unsubscribe", { subscription_id: previous }).catch(() => {});
      })
      .catch(() => {
        // 订阅建不起来（内核没了，或者图案不合法）: 让迭代安静地结束。
        for (const sink of this.sinks) sink.queue.close();
        this.sinks.length = 0;
        this.subscription = null;
      });
    return this.chain;
  }

  private log(chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      this.stderrTail.push(line);
      if (this.stderrTail.length > 32) this.stderrTail.shift();
      if (!this.onLog) {
        process.stderr.write(line + "\n");
        continue;
      }
      try {
        this.onLog(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // 内核只写 JSON，但它写什么都不是协议的一部分。
      }
    }
  }

  /** 内核没了: 把所有等着的人叫醒，别让他们挂到天荒地老。 */
  private fail(error: Error): void {
    for (const call of this.calls.values()) call.reject(error);
    this.calls.clear();
    for (const queue of this.streams.values()) queue.close();
    this.streams.clear();
    for (const sink of this.sinks) sink.queue.close();
    this.sinks.length = 0;
    this.subscription = null;
  }

  private died(code: number): Error {
    const report = [...this.stderrTail].reverse().find((line) => line.includes('"ok"'));
    const detail = report ?? this.stderrTail.at(-1) ?? "";
    return new Error(`eggshell 退出了（code ${code}）${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * 起一个内核。返回时插件已经 initialize + start 过（`capabilities` 能应答就是证据）。
 *
 * 配置文件读不了、或者配置读得了但起不来，内核会以退出码 1 退出，
 * 并把 JSON 报告写在 stderr 上 —— 这里把它包进异常里抛出来。
 */
export async function boot(configPath: string, options: KernelOptions = {}): Promise<Host> {
  const bin = options.bin ?? process.env.EGGSHELL_BIN ?? "eggshell";
  const child = spawn(bin, [configPath], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    // 永远不要让内核继承我们的 stdin: 那是宿主自己的终端。
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const host = new Host(child, options.onLog);
  try {
    await host.capabilities();
  } catch (error) {
    child.kill();
    throw error;
  }
  return host;
}