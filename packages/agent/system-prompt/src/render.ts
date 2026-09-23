import { CallError } from "@maota/plugin-kit";

/// Variables are written `{{name}}` and nothing else is special: a brace that
/// opens and never closes is left alone, because a prompt that talks about
/// configuration syntax is not asking to be interpolated.
const OPEN = "{{";
const CLOSE = "}}";

export type Values = (name: string) => string | undefined;

export function interpolate(text: string, values: Values): string {
  let out = "";
  let index = 0;
  for (;;) {
    const start = text.indexOf(OPEN, index);
    if (start < 0) return out + text.slice(index);
    const end = text.indexOf(CLOSE, start + OPEN.length);
    if (end < 0) return out + text.slice(index);
    const name = text.slice(start + OPEN.length, end).trim();
    if (name === "") {
      out += text.slice(index, end + CLOSE.length);
      index = end + CLOSE.length;
      continue;
    }
    const value = values(name);
    if (value === undefined) throw new CallError(-32602, `unknown prompt variable: ${name}`);
    out += text.slice(index, start) + value;
    index = end + CLOSE.length;
  }
}

/// A section that came out empty says nothing and takes no blank line with it,
/// so a deployment without a working directory reads as one paragraph shorter
/// rather than one paragraph of nothing.
export function joinBlocks(blocks: readonly string[]): string {
  const kept: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed !== "") kept.push(trimmed);
  }
  return kept.join("\n\n");
}
