
type Kernel = Awaited<ReturnType<typeof import("@maota/host").boot>>;

function jobLine(job: Record<string, unknown>): string {
  return `${String(job.id)} [${String(job.kind)}] ${String(job.status)} - ${String(job.label)}`;
}

export async function runJobsCommand(kernel: Kernel, session: string, action: string, args: string[]): Promise<void> {
  if (action === "list") {
    const reply = (await kernel.invoke("jobs", "list", { owner: session })) as { jobs?: Array<Record<string, unknown>> };
    const jobs = reply.jobs ?? [];
    console.log(jobs.length === 0 ? "(no background jobs)" : jobs.map(jobLine).join("\n"));
    return;
  }
  if (action === "show") {
    const id = args[0];
    if (id === undefined) throw new Error("maota jobs show needs a job id");
    const reply = (await kernel.invoke("jobs", "read", { id, owner: session })) as Record<string, unknown>;
    const chunks = Array.isArray(reply.chunks) ? reply.chunks : [];
    const text = chunks.map((chunk) => String((chunk as { text?: unknown }).text ?? "")).join("");
    if (text !== "") console.log(text);
    const job = reply.job as Record<string, unknown> | undefined;
    if (job !== undefined) console.log(`[status: ${String(job.status)}]`);
    return;
  }
  if (action === "kill") {
    const id = args[0];
    if (id === undefined) throw new Error("maota jobs kill needs a job id");
    const reply = (await kernel.invoke("jobs", "kill", { id, owner: session, reason: "CLI request" })) as {
      outcome?: unknown;
    };
    console.log(`${String(reply.outcome ?? "requested")}: ${id}`);
    return;
  }
  throw new Error(`unknown jobs action ${JSON.stringify(action)}`);
}