import { CallError } from "@maota/plugin-kit";

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;
const SECRET = /(api[_-]?key|secret|token|password)\s*[:=]\s*\S+/i;

export function cleanText(value: unknown, field: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new CallError(-32602, `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new CallError(-32602, `${field} must be a string`);
  const text = value.trim();
  if (text === "") {
    if (required) throw new CallError(-32602, `${field} must not be blank`);
    return undefined;
  }
  if (text.length > max) throw new CallError(-32602, `${field} exceeds ${max} characters`);
  if (INVISIBLE.test(text) || SECRET.test(text)) throw new CallError(-32602, `${field} contains a blocked pattern`);
  return text;
}