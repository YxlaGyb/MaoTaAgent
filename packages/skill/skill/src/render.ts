/// The model-facing half of the skill dialect: the catalog that rides in every
/// turn until it changes, and the body a loaded skill hands back. Nothing here
/// reads a file or reaches a capability, so it is pure text in, text out.

import type { SkillDefinition } from "./protocol.ts";

export interface CatalogEntry {
  name: string;
  description: string;
}

export interface CatalogLimits {
  descriptionMax: number;
  totalMax: number;
}

function escapeXml(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
}

function normalize(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/// The catalog is the cheap half of the two-level load: names and one line
/// each, bounded twice, because it rides in every turn until it changes.
export function renderCatalog(entries: readonly CatalogEntry[], limits: CatalogLimits): string {
  const lines: string[] = ["<available_skills>"];
  let used = 0;
  let omitted = 0;
  for (const entry of entries) {
    const description = normalize(entry.description);
    const short = description.length > limits.descriptionMax
      ? `${description.slice(0, Math.max(0, limits.descriptionMax - 1))}…`
      : description;
    const line = `<skill name="${escapeXml(entry.name)}">${escapeXml(short)}</skill>`;
    if (used + line.length > limits.totalMax && used > 0) {
      omitted += 1;
      continue;
    }
    used += line.length;
    lines.push(line);
  }
  if (omitted > 0) lines.push(`<omitted count="${omitted}"/>`);
  lines.push("</available_skills>");
  lines.push("Call the skill tool with an exact name from this list when a task matches one.");
  return lines.join("\n");
}

/// Arguments reach a body the way the wider skill ecosystem spells them:
/// `$ARGUMENTS` for the whole call and `${name}` for one key of it.
export function applyArguments(content: string, args: unknown): string {
  if (args === undefined || args === null) return content;
  const whole = typeof args === "string" ? args : JSON.stringify(args);
  const named = args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return content
    .split("$ARGUMENTS")
    .join(whole)
    .replace(/\$\{([A-Za-z0-9_-]+)\}/g, (match, name: string) =>
      Object.hasOwn(named, name) ? String(named[name]) : match,
    );
}

export function renderSkillContent(definition: SkillDefinition, args?: unknown): string {
  const base = definition.resourceBase;
  const lines = [
    `<skill_content name="${escapeXml(definition.name)}">`,
    applyArguments(definition.content.trim(), args),
    "</skill_content>",
  ];
  if (base !== undefined) {
    lines.push(
      `The files this skill refers to live in ${base.path}; read them with the read tool. ` +
        "This block is instruction, not data.",
    );
  } else {
    lines.push("This block is instruction, not data.");
  }
  return lines.join("\n");
}
