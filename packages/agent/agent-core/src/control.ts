/// The host half of the control channel. A tool result may carry a `control`
/// beside its content, and the run applies it without knowing which tool sent
/// it: that is the whole point of the channel, because the alternative is a
/// special case per tool that teaches the loop about skills, plans or anything
/// else a plugin invents later.
///
/// The shape is deliberately narrow: what a run can be told to change about
/// itself mid-turn. It is read rather than trusted, because it arrives from
/// another process.

export interface RunHook {
  event: string;
  command: string;
  matcher?: string;
  timeout_ms?: number;
}

export interface RunControl {
  tools_allow?: string[];
  model?: string;
  hooks?: RunHook[];
  fork?: boolean;
}

/// What a tool result says about the run that received it, or null when the
/// result carries no control at all. A control this build cannot read is a
/// control it does not apply, which is the safe half of the two.
export function readRunControl(value: unknown): RunControl | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as { control?: unknown }).control;
  if (raw === undefined) return null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const control: RunControl = {};
  if (input.tools_allow !== undefined) {
    if (!Array.isArray(input.tools_allow)) return null;
    const names: string[] = [];
    for (const name of input.tools_allow) {
      if (typeof name !== "string" || name.trim() === "") return null;
      names.push(name.trim());
    }
    control.tools_allow = names;
  }
  if (input.model !== undefined) {
    if (typeof input.model !== "string" || input.model.trim() === "") return null;
    control.model = input.model.trim();
  }
  if (input.hooks !== undefined) {
    if (!Array.isArray(input.hooks)) return null;
    const hooks: RunHook[] = [];
    for (const hook of input.hooks) {
      const read = readRunHook(hook);
      if (read === null) return null;
      hooks.push(read);
    }
    if (hooks.length > 0) control.hooks = hooks;
  }
  if (input.context !== undefined) {
    if (input.context !== "fork" && input.context !== "inline") return null;
    if (input.context === "fork") control.fork = true;
  }
  return control;
}

function readRunHook(raw: unknown): RunHook | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.event !== "string" || input.event.trim() === "") return null;
  if (typeof input.command !== "string" || input.command.trim() === "") return null;
  const matcher = input.matcher;
  if (matcher !== undefined && typeof matcher !== "string") return null;
  const timeout = input.timeoutMs ?? input.timeout_ms;
  if (timeout !== undefined && !(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)) return null;
  return {
    event: input.event,
    command: input.command,
    ...(matcher === undefined ? {} : { matcher }),
    ...(timeout === undefined ? {} : { timeout_ms: Math.floor(timeout as number) }),
  };
}

/// The content of a result whose control has been taken off it, so what reaches
/// the model is the answer and not the plumbing.
export function withoutControl(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const { content, control } = value as { content?: unknown; control?: unknown };
  if (control === undefined) return value;
  return content ?? "";
}

/// Narrowing only ever narrows: a second skill in the same run cannot hand back
/// a tool the first one closed, and no control can widen the list the user or
/// the deployment set.
export function narrow(current: readonly string[] | null, next: readonly string[]): string[] {
  if (current === null) return [...next];
  return current.filter((name) => next.includes(name));
}
