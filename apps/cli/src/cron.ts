type Kernel = Awaited<ReturnType<typeof import("@maota/host").boot>>;

function render(record: Record<string, unknown>): string {
  const next = record.next_at === null ? "ended" : String(record.next_at ?? "");
  return `${String(record.id)} [${String(record.mode)}] ${record.enabled === false ? "paused" : "active"} ${next} - ${String(record.title)}`;
}

function jsonArg(value: string | undefined): Record<string, unknown> {
  if (value === undefined) throw new Error("a JSON argument is required");
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the JSON argument must be an object");
  return parsed as Record<string, unknown>;
}

export async function runCronCommand(kernel: Kernel, session: string, action: string, args: string[]): Promise<void> {
  if (action === "list") {
    const reply = (await kernel.invoke("schedule", "list", {})) as { schedules?: Array<Record<string, unknown>> };
    const records = reply.schedules ?? [];
    console.log(records.length === 0 ? "(no schedules)" : records.map(render).join("\n"));
    return;
  }
  if (action === "add") {
    const input = jsonArg(args[0]);
    input.source_session_id = session;
    input.source_cwd = process.cwd();
    const record = (await kernel.invoke("schedule", "create", input)) as Record<string, unknown>;
    console.log(render(record));
    return;
  }
  if (action === "update") {
    const id = args[0];
    if (id === undefined) throw new Error("maota cron update needs an id");
    const patch = jsonArg(args[1]);
    const record = (await kernel.invoke("schedule", "update", { id, ...patch })) as Record<string, unknown>;
    console.log(render(record));
    return;
  }
  if (action === "remove") {
    const id = args[0];
    if (id === undefined) throw new Error("maota cron remove needs an id");
    await kernel.invoke("schedule", "delete", { id });
    console.log(`deleted ${id}`);
    return;
  }
  if (action === "run") {
    const id = args[0];
    if (id === undefined) throw new Error("maota cron run needs an id");
    const result = (await kernel.invoke("schedule", "run_now", { id })) as Record<string, unknown>;
    console.log(`${String(result.status)} ${String(result.occurrence)}`);
    return;
  }
  if (action === "pause" || action === "resume") {
    const id = args[0];
    if (id === undefined) throw new Error(`maota cron ${action} needs an id`);
    const record = (await kernel.invoke("schedule", "update", { id, enabled: action === "resume" })) as Record<string, unknown>;
    console.log(render(record));
    return;
  }
  throw new Error(`unknown cron action ${JSON.stringify(action)}`);
}