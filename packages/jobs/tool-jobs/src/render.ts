import type { JobRead, JobView } from "@maota/jobs/src/types.ts";

export function renderJobs(jobs: JobView[]): string {
  if (jobs.length === 0) return "(no background jobs)";
  return jobs
    .map((job) => `${job.id} [${job.kind}] ${job.status} - ${job.label}${job.progress ? ` (${job.progress})` : ""}`)
    .join("\n");
}

export function renderRead(read: JobRead): { text: string; job: JobView; lossy: boolean; result?: string } {
  const body = read.chunks.map((chunk) => (chunk.channel ? `[${chunk.channel}] ${chunk.text}` : chunk.text)).join("");
  const output = body === "" ? "(no new output)" : body;
  return {
    text: `${output}\n[status: ${read.job.status}${read.job.detail ? ` - ${read.job.detail}` : ""}]`,
    job: read.job,
    lossy: read.lossy,
    ...(read.result === undefined ? {} : { result: read.result }),
  };
}