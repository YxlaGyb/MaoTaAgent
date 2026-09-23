/// The text half of the skill dialect: reading one file's frontmatter. A
/// deliberately small YAML subset: `key: value`, inline lists, block lists
/// whose items are scalars, inline maps, and block maps inside a list. That is
/// exactly what the frontmatter keys here need and nothing more, so a document
/// this build cannot read is reported rather than half-read.

export const DEFAULT_DESCRIPTION_MAX = 500;
export const DEFAULT_CATALOG_MAX = 8000;

export interface Frontmatter {
  data: Record<string, unknown>;
  unsupported: string[];
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const content = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { data: {}, unsupported: [], body: content };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) return { data: {}, unsupported: [], body: content };

  const data: Record<string, unknown> = {};
  const unsupported: string[] = [];
  let sequence: string | null = null;
  let openMap: Record<string, string> | null = null;
  let mapIndent = -1;

  for (let index = 1; index < end; index += 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const dash = /^(\s*)-\s*(.*)$/.exec(line);
    if (dash !== null) {
      if (sequence === null || !Array.isArray(data[sequence])) {
        if (sequence !== null) unsupported.push(sequence);
        sequence = null;
        openMap = null;
        mapIndent = -1;
        continue;
      }
      const body = (dash[2] ?? "").trim();
      const nested = inlineMap(body) ?? pairMap(body);
      if (nested !== null) {
        (data[sequence] as unknown[]).push(nested);
        openMap = nested;
        mapIndent = (dash[1] ?? "").length;
      } else {
        (data[sequence] as unknown[]).push(unquote(body));
        openMap = null;
        mapIndent = -1;
      }
      continue;
    }

    const pair = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    const indent = line.length - line.trimStart().length;
    if (openMap !== null && pair !== null && indent > mapIndent) {
      openMap[(pair[1] as string).toLowerCase()] = unquote((pair[2] as string).trim());
      continue;
    }
    openMap = null;
    mapIndent = -1;

    if (pair === null) {
      if (sequence !== null) unsupported.push(sequence);
      sequence = null;
      continue;
    }
    const key = (pair[1] as string).toLowerCase();
    const raw = (pair[2] as string).trim();
    sequence = key;
    if (raw === "") {
      data[key] = [];
      continue;
    }
    if (raw === "|" || raw === ">") {
      data[key] = "";
      unsupported.push(key);
      continue;
    }
    data[key] = inlineList(raw) ?? unquote(raw);
  }

  return { data, unsupported, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function inlineList(raw: string): string[] | null {
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;
  return raw
    .slice(1, -1)
    .split(",")
    .map((part) => unquote(part.trim()))
    .filter((part) => part !== "");
}

function inlineMap(raw: string): Record<string, string> | null {
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  const out: Record<string, string> = {};
  for (const part of raw.slice(1, -1).split(",")) {
    const pair = pairMap(part.trim());
    if (pair === null) return null;
    Object.assign(out, pair);
  }
  return out;
}

function pairMap(raw: string): Record<string, string> | null {
  const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/.exec(raw);
  if (pair === null) return null;
  const value = (pair[2] as string).trim();
  if (value === "|" || value === ">") return null;
  return { [(pair[1] as string).toLowerCase()]: unquote(value) };
}

function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0] as string;
    const last = raw[raw.length - 1] as string;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return raw.slice(1, -1);
  }
  const comment = raw.indexOf(" #");
  return comment >= 0 ? raw.slice(0, comment).trim() : raw;
}

export function firstParagraph(body: string): string {
  for (const line of String(body ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}
