import { getLang, tr } from "./i18n.ts";
import { CallFailed } from "./rpc.ts";

const TABLE: Record<number, string> = {
  [-32050]: "errKey",
  [-32051]: "errRate",
  [-32052]: "errGateway",
  [-32053]: "errBroken",
  [-32054]: "errGarbage",
  [-32055]: "errEmpty",
  [-32012]: "errTimeout",
  [-32013]: "errCancelled",
  [-32011]: "errUnavailable",
};

export function errorText(code: number, message: string, lang: string = getLang()): string {
  if (code === -32602) return message;
  const key = TABLE[code];
  return key === undefined ? tr(lang, "errUnknown", { code, message }) : tr(lang, key);
}

export function describe(error: unknown): string {
  if (error instanceof CallFailed) return errorText(error.code, error.message);
  return error instanceof Error ? error.message : String(error);
}
