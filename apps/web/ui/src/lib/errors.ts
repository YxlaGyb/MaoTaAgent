import { getLang, tr, type MessageKey } from "./i18n.ts";
import { CallFailed, type HostFailure } from "./rpc.ts";

/// The codes this page can name, and only the codes something in this tree
/// actually reports. A gateway failure is read by its kind rather than its
/// number, so these are the non-gateway ones: the host's own refusals of a
/// capability whose provider is gone, and the abort the loop raises.
const TABLE: Record<number, MessageKey> = {
  [-32011]: "errUnavailable",
  [-32013]: "errCancelled",
};

/// A failure that crossed the wire as facts is read by its kind, not by its
/// code: the page says the same thing about a rate limit whether the provider
/// reported it as HTTP 429 or as a body-level quota code.
const KINDS: Record<string, MessageKey> = {
  rate_limit: "errRate",
  server: "errGateway",
  transport: "errBroken",
  timeout: "errTimeout",
  empty_response: "errEmpty",
  context_window: "errContext",
  auth: "errKey",
  quota: "errQuota",
  request: "errRequest",
  protocol: "errGarbage",
  aborted: "errCancelled",
};

export function errorText(code: number, message: string, lang: string = getLang()): string {
  if (code === -32602) return message;
  const key = TABLE[code];
  return key === undefined ? tr(lang, "errUnknown", { code, message }) : tr(lang, key);
}

/// A provider that said something specific is quoted rather than replaced: the
/// kind names the class of failure, and the message is what it actually said.
export function failureText(failure: HostFailure, lang: string = getLang()): string {
  const key = KINDS[failure.kind];
  if (key === undefined) return tr(lang, "errUnknown", { code: failure.code, message: failure.message });
  return `${tr(lang, key)}: ${failure.message}`;
}

export function describe(error: unknown): string {
  if (error instanceof CallFailed) return errorText(error.code, error.message);
  return error instanceof Error ? error.message : String(error);
}
