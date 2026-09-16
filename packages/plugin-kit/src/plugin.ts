// 插件的生命周期: initialize / start / invoke / shutdown（PROTOCOL.md 第 3 节）。
// 业务代码只写 methods + setup；协议的事这里全包了。
import { writeSync } from "node:fs";

import { Channel, CallError, type Route } from "./channel.ts";

export interface Provide {
  capability: string;
  version: string;
}

export interface Require {
  capability: string;
  version: string;
  optional?: boolean;
}

/** initialize 给你 config，start 给你整张路由表快照；同一个对象，按顺序填。 */
export interface Wiring {
  channel: Channel;
  config: Record<string, unknown>;
  capabilities: Record<string, Route>;
}

/** 一次 invoke 的上下文。 */
export interface Call extends Wiring {
  capability: string;
  method: string;
  /** "host" 或某个插件 id，内核写的，调用方自己说的不算。 */
  caller: string;
  /** 调用方取消（或内核超时）时中止。 */
  signal: AbortSignal;
  /** meta.stream 为 true 时才有；推块用它。 */
  stream: ProviderStream | undefined;
}

export type Method = (params: any, call: Call) => Promise<unknown> | unknown;

export interface Definition {
  provides: Provide[];
  requires?: Require[];
  /** initialize 时一次: 读 config，建连接之类。 */
  setup?(wiring: Wiring): void | Promise<void>;
  /** 依赖的 start 都回来了，路由表就绪。 */
  start?(wiring: Wiring): void | Promise<void>;
  methods: Record<string, Method>;
  /** shutdown 回包之后、退出之前。 */
  close?(reason: string): void | Promise<void>;
  /** --check 用: 不接内核也能跑的自我检查，返回问题清单（空数组 = 通过）。 */
  selfCheck?(): string[] | Promise<string[]>;
}

/** 我们当提供方的一条流（PROTOCOL.md 7.2）。 */
export class ProviderStream {
  readonly id: string;
  private readonly channel: Channel;
  private open = false;
  private seq = 0;
  private buffered: unknown[] = [];
  private finished = false;

  constructor(id: string, channel: Channel) {
    this.id = id;
    this.channel = channel;
  }

  /** 内核在收到 {stream_id} 之前拿到的块会当孤儿丢掉，所以先来的块在这里排队。 */
  push(data: unknown): void {
    if (this.finished) return;
    if (!this.open) {
      this.buffered.push(data);
      return;
    }
    this.channel.notify("$/stream/chunk", { stream_id: this.id, seq: this.seq++, data, done: false });
  }

  /** 应答发出去之后才能开闸。 */
  opened(): void {
    if (this.open) return;
    this.open = true;
    const buffered = this.buffered;
    this.buffered = [];
    for (const data of buffered) this.push(data);
  }

  /** 终止块: data 必须是 null，否则内核记一条 warning 再丢掉它。 */
  end(): void {
    if (this.finished) return;
    this.finished = true;
    this.channel.notify("$/stream/chunk", { stream_id: this.id, seq: this.seq++, data: null, done: true });
  }

  fail(code: number, message: string, data?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.channel.notify("$/stream/error", { stream_id: this.id, code, message, data });
  }

  /** 调用方自己不要了: 什么都别再发。 */
  stop(): void {
    this.finished = true;
  }
}

export function serve(definition: Definition): void {
  const wiring: Wiring = { channel: null as unknown as Channel, config: {}, capabilities: {} };
  /** 内核给一次 invoke 编的号 → 取消闸门（PROTOCOL.md 7.6）。 */
  const aborts = new Map<number, AbortController>();

  const channel = new Channel({
    request: (method, params, reply) => handle(definition, wiring, aborts, method, params, reply),
    notification: (method, params) => {
      if (method !== "$/cancel") return;
      const requestId = params?.request_id;
      if (typeof requestId === "number") aborts.get(requestId)?.abort();
    },
    event: () => {},
  });
  wiring.channel = channel;
  channel.listen();
}

async function handle(
  definition: Definition,
  wiring: Wiring,
  aborts: Map<number, AbortController>,
  method: string,
  params: any,
  reply: (result: unknown) => void,
): Promise<void> {
  switch (method) {
    case "initialize": {
      wiring.config = { ...(params?.config ?? {}) };
      await definition.setup?.(wiring);
      reply({ protocol: 1, provides: definition.provides, requires: definition.requires ?? [] });
      return;
    }
    case "start": {
      wiring.capabilities = { ...(params?.capabilities ?? {}) };
      await definition.start?.(wiring);
      reply({});
      return;
    }
    case "invoke": {
      await invoke(definition, wiring, aborts, params, reply);
      return;
    }
    case "shutdown": {
      // 先回包再收尾: 宿主等的是这一帧。
      reply({});
      await definition.close?.(String(params?.reason ?? ""));
      process.exit(0);
      return;
    }
    default:
      throw new CallError(-32601, `no ${method} here`);
  }
}

async function invoke(
  definition: Definition,
  wiring: Wiring,
  aborts: Map<number, AbortController>,
  params: any,
  reply: (result: unknown) => void,
): Promise<void> {
  const method = String(params?.method ?? "");
  const handler = definition.methods[method];
  if (!handler) throw new CallError(-32601, `no method ${method} here`);

  const meta = params?.meta ?? {};
  const kernelId = Number(meta.request_id);
  const known = Number.isFinite(kernelId);
  const controller = new AbortController();
  if (known) aborts.set(kernelId, controller);

  const streaming = meta.stream === true;
  const stream = streaming ? new ProviderStream(`s-${kernelId}`, wiring.channel) : undefined;
  const call: Call = {
    ...wiring,
    capability: String(params?.capability ?? ""),
    method,
    caller: String(meta.caller ?? ""),
    signal: controller.signal,
    stream,
  };

  try {
    if (stream) {
      reply({ stream_id: stream.id });
      stream.opened();
      await handler(params?.params, call);
      stream.end();
    } else {
      reply(await handler(params?.params, call));
    }
  } catch (error) {
    if (!stream) throw error; // 交给 Channel 回错误帧
    // 调用方自己取消的，就别再往那条流上写东西了。
    if (controller.signal.aborted) stream.stop();
    else if (error instanceof CallError) stream.fail(error.code, error.message, error.data);
    else stream.fail(-32603, error instanceof Error ? error.message : String(error));
  } finally {
    if (known) aborts.delete(kernelId);
  }
}

/**
 * 插件的入口: 默认接内核，--check 时只体检自己。
 *
 *     node packages/<name>/src/main.ts            # 内核拉起来的那个进程
 *     node packages/<name>/src/main.ts --check    # 声明 + selfCheck，不碰内核
 */
export function runPlugin(definition: Definition, argv: readonly string[] = process.argv.slice(2)): void {
  if (argv.includes("--check")) {
    void check(definition);
    return;
  }
  serve(definition);
}

async function check(definition: Definition): Promise<void> {
  const problems: string[] = [];
  if (definition.provides.length === 0) problems.push("provides is empty");
  for (const item of definition.provides) {
    // 内核要用 provides 的版本去满足别人的 range，所以它必须是完整 semver。
    if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(item.version)) {
      problems.push(`${item.capability}: "${item.version}" is not a full semver`);
    }
    if (!/^[a-z][a-z0-9._-]*$/.test(item.capability)) {
      problems.push(`capability "${item.capability}" should be a lowercase id`);
    }
  }
  for (const item of definition.requires ?? []) {
    if (item.version.trim() === "") problems.push(`requires ${item.capability}: empty range`);
  }
  try {
    problems.push(...((await definition.selfCheck?.()) ?? []));
  } catch (error) {
    problems.push(`selfCheck threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ok = problems.length === 0;
  // --check 不经内核，stdout 上没人等帧，可以当普通输出用。
  writeSync(1, `${JSON.stringify({ ok, provides: definition.provides, requires: definition.requires ?? [], problems })}\n`);
  process.exit(ok ? 0 : 1);
}