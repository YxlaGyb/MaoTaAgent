import { readFileSync, realpathSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

export interface Wiring {
  channel: Channel;
  config: Record<string, unknown>;
  capabilities: Record<string, Route>;
}

export interface Call extends Wiring {
  capability: string;
  method: string;
  caller: string;
  signal: AbortSignal;
  stream: ProviderStream | undefined;
}

export type Method = (params: any, call: Call) => Promise<unknown> | unknown;

export interface Definition {
  provides: Provide[];
  requires?: Require[];
  configKeys?: readonly string[];
  setup?(wiring: Wiring): void | Promise<void>;
  start?(wiring: Wiring): void | Promise<void>;
  methods: Record<string, Method>;
  close?(reason: string): void | Promise<void>;
  selfCheck?(): string[] | Promise<string[]>;
}

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

  push(data: unknown): void {
    if (this.finished) return;
    if (!this.open) {
      this.buffered.push(data);
      return;
    }
    this.channel.notify("$/stream/chunk", { stream_id: this.id, seq: this.seq++, data, done: false });
  }

  opened(): void {
    if (this.open) return;
    this.open = true;
    const buffered = this.buffered;
    this.buffered = [];
    for (const data of buffered) this.push(data);
  }

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

  stop(): void {
    this.finished = true;
  }
}

export function serve(definition: Definition): void {
  const wiring: Wiring = { channel: null as unknown as Channel, config: {}, capabilities: {} };
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

export function unknownConfigKeys(known: readonly string[] | undefined, config: Record<string, unknown>): string[] {
  if (!known) return [];
  return Object.keys(config).filter((key) => !known.includes(key));
}

export function unknownConfigWarning(id: string, known: readonly string[], unknown: readonly string[]): string {
  const reads = known.length > 0 ? `this plugin reads: ${known.join(", ")}` : "this plugin reads no config";
  const keys = unknown.length === 1 ? "key" : "keys";
  return `unknown config ${keys} in plugins.${id}.config: ${unknown.join(", ")} (${reads})`;
}

function warnUnknownConfig(definition: Definition, params: any, wiring: Wiring): void {
  const known = definition.configKeys;
  const unknown = unknownConfigKeys(known, wiring.config);
  if (known === undefined || unknown.length === 0) return;
  const id = String(params?.plugin_id ?? "?");
  wiring.channel.log("warn", unknownConfigWarning(id, known, unknown), { plugin_id: id, unknown, known });
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
      warnUnknownConfig(definition, params, wiring);
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
    if (!stream) throw error;
    if (controller.signal.aborted) stream.stop();
    else if (error instanceof CallError) stream.fail(error.code, error.message, error.data);
    else stream.fail(-32603, error instanceof Error ? error.message : String(error));
  } finally {
    if (known) aborts.delete(kernelId);
  }
}

export function runPlugin(definition: Definition, argv: readonly string[] = process.argv.slice(2)): void {
  if (argv.includes("--check")) {
    void check(definition);
    return;
  }
  serve(definition);
}

/// A package that is spawned as a plugin and imported by its siblings as a
/// library cannot serve on an import: `runPlugin` runs at module scope, so an
/// import would open a second server on the same stdin and one plugin would
/// answer twice. A module that can be imported asks this first, and only the
/// file the process was started with is the plugin; both sides are resolved so
/// a package reached through a linked `node_modules` still matches.
export function isPluginEntry(moduleUrl: string, started: string | undefined = process.argv[1]): boolean {
  if (started === undefined || started === "") return false;
  const here = real(moduleUrl);
  const main = real(started);
  return here !== null && main !== null && here === main;
}

function real(path: string): string | null {
  try {
    return realpathSync(path.includes("://") ? fileURLToPath(path) : path);
  } catch {
    return null;
  }
}

/// A plugin's version is the version of the package it ships as, read from the
/// manifest beside it: one release is numbered in one place, and a definition
/// that typed its own would drift the first time the package was bumped
/// without the source following.
export function packageVersion(moduleUrl: string): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", moduleUrl), "utf8")) as { version?: unknown };
  const version = manifest.version;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`no version in the package.json beside ${moduleUrl}`);
  }
  return version;
}

async function check(definition: Definition): Promise<void> {
  const problems: string[] = [];
  if (definition.provides.length === 0) problems.push("provides is empty");
  for (const item of definition.provides) {
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
  if (definition.configKeys === undefined) {
    problems.push("configKeys is not declared: list the config keys initialize reads ([] if none)");
  }
  try {
    problems.push(...((await definition.selfCheck?.()) ?? []));
  } catch (error) {
    problems.push(`selfCheck threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ok = problems.length === 0;
  writeSync(1, `${JSON.stringify({ ok, provides: definition.provides, requires: definition.requires ?? [], problems })}\n`);
  process.exit(ok ? 0 : 1);
}
