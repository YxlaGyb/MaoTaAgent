// SKILL.md 开头那段 `---` 块。只认单行的 key: value —— 够用，不是 YAML 解析器。
export interface Frontmatter {
  name?: string;
  description?: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return out;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") break;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") out.name = value;
    if (key === "description") out.description = value;
  }
  return out;
}

/** 没写 description 时，取正文第一个既不是空行也不是标题的行。 */
export function firstParagraph(text: string): string {
  const body = text.replace(/^---[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}