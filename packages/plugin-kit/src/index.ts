// 插件共同的那一层。每个插件的 main.ts 只从这里拿东西。
export { frameReader, writeFrame } from "./frame.ts";
export { CallError, Channel } from "./channel.ts";
export type { CallOptions, ChannelHooks, InboundStream, Route } from "./channel.ts";
export { ProviderStream, runPlugin, serve } from "./plugin.ts";
export type { Call, Definition, Method, Provide, Require, Wiring } from "./plugin.ts";