/// Glob matching shared by the file tools and by anything that has to decide
/// whether a path belongs to a pattern. Backslashes are path separators here,
/// never escapes, because half the callers hand over a Windows path.

export function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/// The body of one pattern, before it is anchored. A `{a,b}` group offers
/// alternatives, and nothing else is special beyond the three wildcards.
function sourceOf(normalized: string): string {
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] as string;
    if (char === "{") {
      const close = normalized.indexOf("}", index + 1);
      if (close > index + 1) {
        const parts = normalized.slice(index + 1, close).split(",");
        if (parts.length > 1) {
          source += "(?:" + parts.map((part) => sourceOf(part)).join("|") + ")";
          index = close;
          continue;
        }
      }
    }
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += /[.*+?^${}()|[\]\\]/.test(char) ? "\\" + char : char;
  }
  return source;
}

/// A leading `!` negates the whole pattern, so `!**/*.md` means "any path that
/// is not a markdown file". A `{a,b}` group offers alternatives, so
/// `src/{tool,agent}/*.ts` means either directory. Anything else is literal,
/// a backslash included.
export function patternToRegExp(pattern: string): RegExp {
  const normalized = toPosix(pattern);
  const negated = normalized.startsWith("!");
  const body = sourceOf(negated ? normalized.slice(1) : normalized);
  return negated ? new RegExp(`^(?!${body}$)[\\s\\S]*$`) : new RegExp("^" + body + "$");
}

const MAGIC = /[*?]/;

/// A pattern with no wildcard is read as a directory: it matches itself and
/// everything below it, so `src/ui` means what its author meant instead of
/// silently matching nothing.
export function matchesPath(
  pattern: string,
  candidate: string,
  caseInsensitive = process.platform === "win32",
): boolean {
  const normalized = toPosix(String(pattern ?? "").trim());
  if (normalized === "") return false;
  const text = toPosix(candidate);
  const compiled = patternToRegExp(normalized);
  const test = caseInsensitive ? new RegExp(compiled.source, compiled.flags + "i") : compiled;
  if (test.test(text)) return true;
  if (MAGIC.test(normalized)) return false;
  const prefix = normalized.replace(/\/+$/, "");
  if (caseInsensitive) {
    const lower = text.toLowerCase();
    const wanted = prefix.toLowerCase();
    return lower === wanted || lower.startsWith(wanted + "/");
  }
  return text === prefix || text.startsWith(prefix + "/");
}

export function matchesAnyPath(patterns: readonly string[] | undefined, candidates: readonly string[]): boolean {
  if (patterns === undefined || patterns.length === 0) return true;
  for (const pattern of patterns) {
    for (const candidate of candidates) {
      if (candidate !== "" && matchesPath(pattern, candidate)) return true;
    }
  }
  return false;
}
